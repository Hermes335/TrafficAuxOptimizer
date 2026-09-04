# P1 Implementation Plan: Must-Fix Before Field Test

## Overview
This document provides a step-by-step technical breakdown of what is needed to implement each P1 (Priority 1) fix.

---

## P1.1: Replace Hardcoded Staffing Requirements

### Current state
- In [traffic_dss_backend/dashboard/views.py](traffic_dss_backend/dashboard/views.py#L97), every bottleneck is assigned `required_officers: 2` as a fixed constant.
- This does not reflect actual demand based on traffic severity, incidents, or bottleneck characteristics.

### What needs to change

#### Option A: Add a model field to Bottleneck (Simple)
1. **Modify [traffic_dss_backend/core/models.py](traffic_dss_backend/core/models.py)**
   - Add field to `Bottleneck` class:
     ```python
     min_officers_required = models.IntegerField(default=2)
     max_officers_allowed = models.IntegerField(default=5)
     ```
   - Create migration: `python manage.py makemigrations` → `python manage.py migrate`

2. **Update [traffic_dss_backend/dashboard/views.py](traffic_dss_backend/dashboard/views.py#L97)**
   - Replace hardcoded `2` with dynamic computation:
     ```python
     # Base requirement from bottleneck config
     required_officers = b.min_officers_required
     
     # Boost for high TSI
     if tsi_val >= 0.8:
         required_officers = b.max_officers_allowed
     elif tsi_val >= 0.5:
         required_officers = min(b.max_officers_allowed, required_officers + 1)
     
     # Boost for critical incidents
     if active_incident and active_incident.severity == "critical":
         required_officers = min(b.max_officers_allowed, required_officers + 1)
     ```

3. **Add admin interface** to [traffic_dss_backend/adminpanel/admin.py](traffic_dss_backend/adminpanel/admin.py):
   - Display `min_officers_required` and `max_officers_allowed` in Django admin so staff can tune per bottleneck.

#### Option B: Use a rule engine (Advanced)
1. Create a new utility module: `traffic_dss_backend/core/staffing_calculator.py`
   - Function: `def calculate_required_officers(bottleneck, tsi, active_incident) -> int`
   - Apply rules for bottleneck type, incident severity, and traffic conditions
   - Call from `DashboardBottlenecksView`

### Testing
- **Unit test**: verify the staffing calculation returns expected values for various TSI and incident combinations
- **Integration test**: verify the dashboard endpoint includes the correct required_officers count
- **Manual test**: change a bottleneck's TSI in the database, reload dashboard, confirm required count updates

### Verification command
```bash
# After changes, check the dashboard response includes dynamic required_officers
python -c "
import json, urllib.request
base='http://127.0.0.1:8000'
payload=json.dumps({'username':'supervisor','password':'supervisor123'}).encode()
req=urllib.request.Request(base+'/api/auth/login/', data=payload, headers={'Content-Type':'application/json'}, method='POST')
r=urllib.request.urlopen(req, timeout=20)
token=json.load(r)['access']
req=urllib.request.Request(base+'/api/dashboard/bottlenecks/', headers={'Authorization':f'Bearer {token}'})
r=urllib.request.urlopen(req, timeout=20)
rows=json.load(r)
# Check that required_officers varies (not all are 2)
required_vals=set([x['required_officers'] for x in rows if x.get('required_officers')])
print('Required officer counts:', required_vals)
"
```

---

## P1.2: Add Real Assignment Validation Rules

### Current state
- In [traffic_dss_backend/deployments/views.py](traffic_dss_backend/deployments/views.py#L80-L88), the `DeploymentAssignView` accepts any officer-bottleneck-shift combo without validation.
- No checks for officer availability, shift match, or existing assignments.

### What needs to change

#### Add validation in [traffic_dss_backend/deployments/views.py](traffic_dss_backend/deployments/views.py)

1. **Update `DeploymentAssignView.post()` to include validation**:
   ```python
   def post(self, request):
       officer_id = request.data.get("officer")
       bottleneck_id = request.data.get("bottleneck")
       shift = request.data.get("shift")
       
       officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
       bottleneck = Bottleneck.objects.filter(pk=bottleneck_id, is_deleted=False).first()
       
       if not officer or not bottleneck:
           return Response({"detail": "Invalid officer or bottleneck."}, status=400)
       
       # NEW VALIDATION RULES
       # Rule 1: Officer must be available or deployed
       if officer.status not in ["available", "deployed"]:
           return Response(
               {"detail": f"Officer {officer.badge_number} is {officer.status}, cannot assign."}, 
               status=400
           )
       
       # Rule 2: Officer shift must match the assignment shift
       if officer.shift != shift:
           return Response(
               {"detail": f"Officer {officer.badge_number} works {officer.shift} shift, not {shift}."}, 
               status=400
           )
       
       # Rule 3: Officer must not already be assigned elsewhere in this shift
       existing = Deployment.objects.filter(
           is_deleted=False,
           officer=officer,
           shift=shift,
           status="assigned"
       ).first()
       if existing:
           return Response(
               {"detail": f"Officer {officer.badge_number} is already assigned to {existing.bottleneck.name} in {shift} shift."}, 
               status=400
           )
       
       # If all validations pass, proceed
       serializer = DeploymentSerializer(data=request.data)
       serializer.is_valid(raise_exception=True)
       deployment = serializer.save(officer=officer, bottleneck=bottleneck)
       # ... rest of the method
   ```

2. **Optional: Create a validator module** at `traffic_dss_backend/core/assignment_validators.py`:
   - Extract validation rules into reusable functions
   - Can be called from multiple endpoints
   - Easier to maintain and test

### Testing
- **Unit test**: verify that invalid officers are rejected with appropriate error messages
- **Integration test**: 
  - Try to assign an off-duty officer → expect 400
  - Try to assign an officer on the wrong shift → expect 400
  - Try to assign an officer twice in the same shift → expect 400
  - Valid assignment should succeed

### Verification command
```bash
# After changes, try an invalid assignment
python -c "
import json, urllib.request
base='http://127.0.0.1:8000'
# Get token first (use supervisor credentials)
payload=json.dumps({'username':'supervisor','password':'supervisor123'}).encode()
req=urllib.request.Request(base+'/api/auth/login/', data=payload, headers={'Content-Type':'application/json'}, method='POST')
r=urllib.request.urlopen(req)
token=json.load(r)['access']

# Try to assign an off-duty officer
req=urllib.request.Request(base+'/api/deployments/assign/', 
    data=json.dumps({'officer':1, 'bottleneck':'bn-123', 'shift':'afternoon'}).encode(),
    headers={'Authorization':f'Bearer {token}', 'Content-Type':'application/json'},
    method='POST')
try:
    r=urllib.request.urlopen(req)
except Exception as e:
    print('Expected error:', e)
"
```

---

## P1.3: Prevent Duplicate or Overlapping Assignments

### Current state
- The `Deployment` model in [traffic_dss_backend/core/models.py](traffic_dss_backend/core/models.py#L119-L140) has no database-level constraints to prevent overlaps.
- One officer can be assigned to multiple bottlenecks at the same time.

### What needs to change

#### Add database constraints to [traffic_dss_backend/core/models.py](traffic_dss_backend/core/models.py)

1. **Add a unique constraint** to prevent the same officer from being assigned twice in the same shift:
   ```python
   class Deployment(TimeStampedSoftDeleteModel):
       # ... existing fields ...
       
       class Meta:
           indexes = [
               models.Index(fields=["officer", "start_time"]),
               models.Index(fields=["bottleneck", "start_time"]),
               models.Index(fields=["shift", "status"]),
               # NEW: Prevent duplicate assignments in the same shift
               models.UniqueConstraint(
                   fields=["officer", "shift"],
                   condition=models.Q(is_deleted=False, status="assigned"),
                   name="unique_officer_shift_assignment"
               ),
           ]
   ```

2. **Create and run migration**:
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```

#### Add validation in [traffic_dss_backend/deployments/views.py](traffic_dss_backend/deployments/views.py) (if constraint is soft)

If you want to allow the database to accept it but reject at the API level:

```python
def post(self, request):
    # ... existing validation ...
    
    # Check for overlap before creating
    existing_deployment = Deployment.objects.filter(
        is_deleted=False,
        officer_id=officer_id,
        shift=shift,
        status="assigned"
    ).first()
    
    if existing_deployment:
        return Response(
            {"detail": f"Officer is already assigned in {shift} shift."},
            status=status.HTTP_409_CONFLICT
        )
    
    # Safe to create
    serializer = DeploymentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    deployment = serializer.save(officer=officer, bottleneck=bottleneck)
```

### Testing
- **Unit test**: attempt to create two deployments for the same officer in the same shift → should fail
- **Integration test**: post two assignment requests for the same officer → second should get 409 Conflict
- **Manual test**: try using the Gantt chart UI to drag an officer to two bottlenecks → should show error

### Verification command
```bash
# After changes, verify the constraint prevents duplicates
python manage.py shell -c "
from core.models import Deployment, Officer
from django.utils import timezone
# Try to create two deployments for the same officer in the same shift
officer = Officer.objects.filter(is_deleted=False).first()
if officer:
    try:
        d1 = Deployment.objects.create(
            officer=officer, 
            bottleneck_id='bn-1955805d7d',
            shift='afternoon',
            start_time=timezone.now(),
            end_time=timezone.now() + timezone.timedelta(hours=8)
        )
        d2 = Deployment.objects.create(
            officer=officer,
            bottleneck_id='bn-2494101172',
            shift='afternoon',
            start_time=timezone.now(),
            end_time=timezone.now() + timezone.timedelta(hours=8)
        )
        print('ERROR: Constraint not enforced!')
    except Exception as e:
        print('Good: Constraint enforced:', str(e)[:80])
"
```

---

## P1.4: Clean Out Placeholder or Synthetic Badge Values

### Current state
- Live assignment data contains badges like `1001`, `0001`, `2001` which look like test/seed values.
- These are in the Officer table and get referenced in Deployment records.

### What needs to change

#### Step 1: Identify placeholder badges
```bash
python manage.py shell -c "
from core.models import Officer
# Find officers with obviously synthetic badge numbers
placeholders = Officer.objects.filter(badge_number__in=['1001', '0001', '2001', '3001', '9999'])
print('Placeholder officers found:', placeholders.count())
for o in placeholders:
    print(f'  {o.badge_number}: {o.name}, status={o.status}')
"
```

#### Step 2: Choose removal strategy

**Option A: Soft-delete placeholder officers**
```bash
python manage.py shell -c "
from core.models import Officer
from django.utils import timezone

# Soft-delete obvious test badges
test_badges = ['1001', '0001', '2001']
Officer.objects.filter(badge_number__in=test_badges).update(
    is_deleted=True,
    updated_at=timezone.now()
)
print('Soft-deleted test officers')
"
```

**Option B: Quarantine into a separate table** (optional, if you want to preserve history)
1. Create a new model: `QuarantinedOfficer`
2. Migrate test officers there
3. Remove from active Officer table

#### Step 3: Validate no active deployments reference these
```bash
python manage.py shell -c "
from core.models import Deployment, Officer
from django.utils import timezone

# Check if any active deployments reference placeholder badges
test_badges = ['1001', '0001', '2001']
test_officers = Officer.objects.filter(badge_number__in=test_badges)
active_deployments = Deployment.objects.filter(
    is_deleted=False,
    status='assigned',
    officer__in=test_officers
)

if active_deployments.exists():
    print(f'WARNING: {active_deployments.count()} active deployments use placeholder badges')
    # Soft-delete these deployments
    active_deployments.update(is_deleted=True, updated_at=timezone.now())
    print('Soft-deleted these deployments')
else:
    print('No active deployments reference placeholder badges - safe to remove')
"
```

#### Step 4: Verify the dashboard no longer shows them
```bash
# After cleanup, check the dashboard
python -c "
import json, urllib.request
base='http://127.0.0.1:8000'
payload=json.dumps({'username':'supervisor','password':'supervisor123'}).encode()
req=urllib.request.Request(base+'/api/auth/login/', data=payload, headers={'Content-Type':'application/json'}, method='POST')
r=urllib.request.urlopen(req)
token=json.load(r)['access']
req=urllib.request.Request(base+'/api/dashboard/bottlenecks/', headers={'Authorization':f'Bearer {token}'})
r=urllib.request.urlopen(req)
rows=json.load(r)

# Check for placeholder badges in assignment lists
test_badges = {'1001', '0001', '2001'}
found_placeholders = []
for b in rows:
    for officer in b.get('assigned_officers', []):
        if officer['badge_number'] in test_badges:
            found_placeholders.append((b['id'], officer['badge_number']))

if found_placeholders:
    print(f'ERROR: Found {len(found_placeholders)} placeholder badges still in use')
    for bottleneck_id, badge in found_placeholders:
        print(f'  {bottleneck_id}: {badge}')
else:
    print('SUCCESS: No placeholder badges found in assignments')
"
```

### Testing
- **Verification**: run the cleanup script above, confirm placeholder badges are gone from the dashboard
- **Audit check**: verify no active deployments were left orphaned
- **Database check**: confirm Officer records with test badges are marked `is_deleted=True`

---

## Implementation sequence (recommended)

1. **P1.1 - Staffing requirements** (2–3 hours)
   - Add field to Bottleneck model
   - Update dashboard view to compute dynamic values
   - Test with changing TSI values

2. **P1.2 - Assignment validation** (2–3 hours)
   - Add validation logic to DeploymentAssignView
   - Test rejection of invalid officers
   - Verify error messages are clear

3. **P1.3 - Prevent overlaps** (1–2 hours)
   - Add database constraint
   - Run migration
   - Test overlap prevention

4. **P1.4 - Clean seed data** (30 minutes)
   - Identify and soft-delete placeholder officers
   - Remove orphaned deployments
   - Verify dashboard is clean

---

## Estimated total effort
- **Development**: 6–8 hours
- **Testing**: 2–3 hours
- **Deployment**: 1 hour
- **Total**: 9–12 hours for all P1 fixes

## Success criteria
✅ Required officers count varies by TSI and incidents (not always 2)
✅ Invalid assignments are rejected with clear error messages
✅ No officer can be assigned twice in the same shift
✅ Dashboard shows no placeholder badge numbers
✅ All existing deployments are valid (no conflicts)

