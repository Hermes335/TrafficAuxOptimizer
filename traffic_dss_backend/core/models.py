from django.conf import settings
from django.db import models


class TimeStampedSoftDeleteModel(models.Model):
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)
	is_deleted = models.BooleanField(default=False, db_index=True)

	class Meta:
		abstract = True


class Bottleneck(TimeStampedSoftDeleteModel):
	BOTTLENECK_TYPES = [
		("intersection", "Intersection"),
		("bridge", "Bridge"),
		("school_zone", "School Zone"),
		("market", "Market"),
		("terminal", "Terminal"),
		("other", "Other"),
	]

	id = models.CharField(max_length=20, primary_key=True)
	name = models.CharField(max_length=255)
	latitude = models.FloatField()
	longitude = models.FloatField()
	road_priority_weight = models.FloatField(default=1.0)
	district = models.CharField(max_length=120)
	bottleneck_type = models.CharField(max_length=40, choices=BOTTLENECK_TYPES, default="other")

	class Meta:
		indexes = [
			models.Index(fields=["district"]),
			models.Index(fields=["bottleneck_type"]),
		]

	def __str__(self):
		return f"{self.id} - {self.name}"


class Officer(TimeStampedSoftDeleteModel):
	SHIFTS = [
		("morning", "Morning"),
		("afternoon", "Afternoon"),
		("night", "Night"),
	]
	STATUSES = [
		("available", "Available"),
		("deployed", "Deployed"),
		("off_duty", "Off Duty"),
		("unavailable", "Unavailable"),
	]

	name = models.CharField(max_length=255)
	badge_number = models.CharField(max_length=40, unique=True)
	shift = models.CharField(max_length=20, choices=SHIFTS)
	status = models.CharField(max_length=20, choices=STATUSES, default="available")
	skills = models.JSONField(default=list, blank=True)
	current_latitude = models.FloatField(null=True, blank=True)
	current_longitude = models.FloatField(null=True, blank=True)

	class Meta:
		indexes = [
			models.Index(fields=["badge_number"]),
			models.Index(fields=["shift", "status"]),
		]

	def __str__(self):
		return f"{self.badge_number} - {self.name}"


class Incident(TimeStampedSoftDeleteModel):
	TYPES = [
		("collision", "Collision"),
		("road_closure", "Road Closure"),
		("construction", "Construction"),
		("flooding", "Flooding"),
		("other", "Other"),
	]
	SEVERITIES = [
		("critical", "Critical"),
		("major", "Major"),
		("minor", "Minor"),
	]
	STATUSES = [
		("active", "Active"),
		("investigating", "Investigating"),
		("resolved", "Resolved"),
	]

	bottleneck = models.ForeignKey(Bottleneck, on_delete=models.PROTECT, related_name="incidents")
	incident_type = models.CharField(max_length=30, choices=TYPES, default="other")
	severity = models.CharField(max_length=20, choices=SEVERITIES)
	description = models.TextField()
	photo_url = models.URLField(blank=True)
	reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reported_incidents")
	timestamp = models.DateTimeField(db_index=True)
	status = models.CharField(max_length=20, choices=STATUSES, default="active", db_index=True)

	class Meta:
		indexes = [
			models.Index(fields=["timestamp"]),
			models.Index(fields=["severity", "status"]),
			models.Index(fields=["bottleneck", "status"]),
		]


class Deployment(TimeStampedSoftDeleteModel):
	SHIFTS = Officer.SHIFTS
	ASSIGNMENT_TYPES = [
		("static", "Static Post"),
		("mobile", "Mobile Patrol"),
		("response", "Rapid Response"),
	]

	officer = models.ForeignKey(Officer, on_delete=models.PROTECT, related_name="deployments")
	bottleneck = models.ForeignKey(Bottleneck, on_delete=models.PROTECT, related_name="deployments")
	shift = models.CharField(max_length=20, choices=SHIFTS)
	start_time = models.DateTimeField(db_index=True)
	end_time = models.DateTimeField(db_index=True)
	assignment_type = models.CharField(max_length=20, choices=ASSIGNMENT_TYPES, default="static")
	status = models.CharField(max_length=20, default="assigned", db_index=True)

	class Meta:
		indexes = [
			models.Index(fields=["officer", "start_time"]),
			models.Index(fields=["bottleneck", "start_time"]),
			models.Index(fields=["shift", "status"]),
		]


class OptimizationRun(TimeStampedSoftDeleteModel):
	STATUSES = [
		("queued", "Queued"),
		("running", "Running"),
		("completed", "Completed"),
		("failed", "Failed"),
	]

	run_id = models.CharField(max_length=64, unique=True, db_index=True)
	timestamp = models.DateTimeField(db_index=True)
	parameters = models.JSONField(default=dict)
	fitness_scores = models.JSONField(default=list)
	result_data = models.JSONField(default=dict)
	status = models.CharField(max_length=20, choices=STATUSES, default="queued", db_index=True)
	created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="optimization_runs")

	class Meta:
		indexes = [models.Index(fields=["timestamp", "status"])]


class TrafficData(TimeStampedSoftDeleteModel):
	bottleneck = models.ForeignKey(Bottleneck, on_delete=models.CASCADE, related_name="traffic_data")
	timestamp = models.DateTimeField(db_index=True)
	traffic_severity_index = models.FloatField(default=0.0)
	vehicle_count = models.IntegerField(default=0)
	avg_speed = models.FloatField(default=0.0)

	class Meta:
		indexes = [
			models.Index(fields=["bottleneck", "timestamp"]),
			models.Index(fields=["timestamp"]),
		]


class WeatherData(TimeStampedSoftDeleteModel):
	CONDITIONS = [
		("clear", "Clear"),
		("light_rain", "Light Rain"),
		("moderate_rain", "Moderate Rain"),
		("heavy_rain", "Heavy Rain"),
		("severe", "Severe"),
	]

	timestamp = models.DateTimeField(db_index=True)
	condition = models.CharField(max_length=30, choices=CONDITIONS, default="clear")
	temperature = models.FloatField(default=0.0)
	precipitation = models.FloatField(default=0.0)
	weather_impact_factor = models.FloatField(default=1.0)

	class Meta:
		indexes = [models.Index(fields=["timestamp", "condition"])]


class Scenario(TimeStampedSoftDeleteModel):
	name = models.CharField(max_length=120, unique=True)
	description = models.TextField(blank=True)
	preset_parameters = models.JSONField(default=dict)
	is_default = models.BooleanField(default=False, db_index=True)

	class Meta:
		indexes = [models.Index(fields=["is_default", "name"])]


class AuditLog(TimeStampedSoftDeleteModel):
	user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="audit_logs")
	action = models.CharField(max_length=100)
	resource = models.CharField(max_length=120)
	changes = models.JSONField(default=dict)
	timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

	class Meta:
		indexes = [
			models.Index(fields=["timestamp"]),
			models.Index(fields=["resource", "action"]),
		]
