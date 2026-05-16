# Code Review - 2026-05-16

## Summary
Workspace contains 756 lines added across 16 files, primarily adding **POI (Point of Interest) management** and related API endpoints.

---

## Backend (Django)

### Good
- New `POI` model is well-designed with proper indexes for `category` and `is_active`
- `POISerializer` includes all relevant fields
- `TrafficSampleView` includes haversine distance calculation
- `POIListView` uses `permissions.AllowAny` (appropriate for public data)

### Issues

1. **No pagination** in `POIListView` ([views.py:270](traffic_dss_backend/dashboard/views.py#L270))
   - Could cause performance issues with large datasets

2. **N+1 query pattern** in `TrafficSampleView` ([views.py:300-308](traffic_dss_backend/dashboard/views.py#L300-L308))
   - Loads all bottlenecks then iterates in Python; consider using database-level distance with `.annotate()`

3. **Missing POI CRUD endpoints**
   - Only GET list implemented (may be intentional if populated externally)

4. **Permission inconsistency**
   - `POIListView` allows any access while other dashboard endpoints likely require auth

---

## Frontend (React/TypeScript)

### Good
- State refactoring from `isAddMode: boolean` to `addMode: "bottleneck" | "incident" | "poi" | null` is cleaner
- New `pois` state properly typed

### Concerns

1. **Large component** - [Dashboard.tsx](src/app/pages/Dashboard.tsx) is now 600+ lines
   - Recommend extracting sub-components: `<AddMenu>`, `<POIList>`, `<BottleneckDetailPanel>`

2. **Missing API integration**
   - `pois` state defined but backend.ts lacks POI fetch functions
   - Need to add `fetchPOIs()` to [backend.ts](src/app/services/backend.ts)

3. **Duplicate state patterns**
   - New detail panel states suggest extracting detail panel as separate component

---

## Minor
- URL trailing slash inconsistency in [urls.py:34](traffic_dss_backend/dashboard/urls.py#L34)
- Run `python manage.py makemigrations` for new POI model if not done

---

## Key Files
- `traffic_dss_backend/core/models.py` - POI model definition
- `traffic_dss_backend/core/serializers.py` - POI serializer
- `traffic_dss_backend/dashboard/views.py` - POIListView, TrafficSampleView
- `traffic_dss_backend/dashboard/urls.py` - Route definitions
- `src/app/pages/Dashboard.tsx` - Main dashboard component
- `src/app/services/backend.ts` - API client functions