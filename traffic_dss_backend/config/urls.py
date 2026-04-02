"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class HealthCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"status": "ok"})


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        return Response(status=204)


class LoginView(TokenObtainPairView):
    pass


class RefreshView(TokenRefreshView):
    pass

urlpatterns = [
    path('admin/', admin.site.urls),
    path("api/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/login/", LoginView.as_view(), name="auth-login"),
    path("api/auth/refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("api/auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("api/dashboard/", include("dashboard.urls")),
    path("api/optimization/", include("optimization.urls")),
    path("api/deployments/", include("deployments.urls")),
    path("api/incidents/", include("incidents.urls")),
    path("api/scenarios/", include("scenarios.urls")),
    path("api/", include("external.urls")),
    path("api/admin/", include("adminpanel.urls")),
    path("api/health/", HealthCheckView.as_view(), name="api-health"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
