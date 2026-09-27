from django.contrib import admin

from .models import (
	AuditLog,
	Bottleneck,
	Deployment,
	Incident,
	Officer,
	OptimizationRun,
	TrafficData,
	WeatherData,
)

admin.site.register(Bottleneck)
admin.site.register(Officer)
admin.site.register(Incident)
admin.site.register(Deployment)
admin.site.register(OptimizationRun)
admin.site.register(TrafficData)
admin.site.register(WeatherData)
admin.site.register(AuditLog)

# Register your models here.
