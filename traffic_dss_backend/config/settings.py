import os
from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
)
environ.Env.read_env(BASE_DIR / ".env")

DEPLOYMENT_ENV = env("DJANGO_ENV", default="development").strip().lower()
IS_PRODUCTION = DEPLOYMENT_ENV in {"production", "prod"}


def _load_signing_secret(name: str, development_default: str) -> str:
    value = env(name, default=None if IS_PRODUCTION else development_default)
    if IS_PRODUCTION:
        if not value or len(value) < 32 or value.startswith("change-"):
            raise ImproperlyConfigured(
                f"{name} must be set to a non-placeholder secret of at least 32 characters in production."
            )
    return value or development_default

SECRET_KEY = _load_signing_secret("SECRET_KEY", "change-this-development-secret-key-at-least-32-chars-long")
DEBUG = env.bool("DEBUG", default=not IS_PRODUCTION)
if IS_PRODUCTION and DEBUG:
    raise ImproperlyConfigured("DEBUG must be False in production.")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")


# Application definition

INSTALLED_APPS = [
    "daphne",
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    "guardian",
    "rest_framework",
    "rest_framework.authtoken",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "corsheaders",
    "channels",
    "core",
    "dashboard",
    "optimization",
    "deployments",
    "incidents",
    "adminpanel",
    "external",
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    "corsheaders.middleware.CorsMiddleware",
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = "config.asgi.application"


# Database
# https://docs.djangoproject.com/en/4.2/ref/settings/#databases

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
    )
}


# Password validation
# https://docs.djangoproject.com/en/4.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/4.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'Asia/Manila'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.2/howto/static-files/

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Default primary key field type
# https://docs.djangoproject.com/en/4.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTHENTICATION_BACKENDS = (
    "django.contrib.auth.backends.ModelBackend",
    "guardian.backends.ObjectPermissionBackend",
)
ANONYMOUS_USER_NAME = "anonymous"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/hour",
        "login": "10/min",
        "refresh": "30/min",
        "operational_read": "300/min",
        "public_dashboard": "60/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": env("JWT_ALGORITHM", default="HS256"),
    "SIGNING_KEY": _load_signing_secret("JWT_SECRET_KEY", "change-this-jwt-signing-key-at-least-32-chars-long"),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Traffic Deployment DSS API",
    "DESCRIPTION": "Backend APIs for traffic deployment decision support.",
    "VERSION": "1.0.0",
}

if IS_PRODUCTION:
    if env.bool("CORS_ALLOW_ALL_ORIGINS", default=False):
        raise ImproperlyConfigured("CORS_ALLOW_ALL_ORIGINS must be False in production.")
    CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
    if not CORS_ALLOWED_ORIGINS:
        raise ImproperlyConfigured("CORS_ALLOWED_ORIGINS must list approved origins in production.")
    CORS_ALLOW_ALL_ORIGINS = False
else:
    CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=True)
    CORS_ALLOWED_ORIGINS = env.list(
        "CORS_ALLOWED_ORIGINS",
        default=["http://localhost:8080", "http://127.0.0.1:8080"],
    )

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")
TOMTOM_API_KEY = env("TOMTOM_API_KEY", default="")
PAGASA_API_ENDPOINT = env("PAGASA_API_ENDPOINT", default="")
ILOILO_LATITUDE = env.float("ILOILO_LATITUDE", default=10.7202)
ILOILO_LONGITUDE = env.float("ILOILO_LONGITUDE", default=122.5621)
GDAL_LIBRARY_PATH = env("GDAL_LIBRARY_PATH", default="") or None
GEOS_LIBRARY_PATH = env("GEOS_LIBRARY_PATH", default="") or None
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=REDIS_URL)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

# Operational input/publication and interrupted-job limits, in seconds.
PUBLICATION_MAX_INPUT_AGE = env.int("PUBLICATION_MAX_INPUT_AGE", default=900)
TRAFFIC_MAX_INPUT_AGE = env.int("TRAFFIC_MAX_INPUT_AGE", default=900)
WEATHER_MAX_INPUT_AGE = env.int("WEATHER_MAX_INPUT_AGE", default=1800)
OPTIMIZATION_QUEUE_TIMEOUT = env.int("OPTIMIZATION_QUEUE_TIMEOUT", default=600)
OPTIMIZATION_HEARTBEAT_TIMEOUT = env.int("OPTIMIZATION_HEARTBEAT_TIMEOUT", default=300)
CELERY_TASK_SOFT_TIME_LIMIT = 1800
CELERY_TASK_TIME_LIMIT = 1860
BACKEND_VERSION = "2026.09.28"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL],
        },
    }
}

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "IGNORE_EXCEPTIONS": True,
        },
        "TIMEOUT": 300,
    }
}

LOG_DIR = env("LOG_DIR", default=str(BASE_DIR / "logs"))
os.makedirs(LOG_DIR, exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO"},
        "optimization": {"handlers": ["console"], "level": "INFO"},
        "external_apis": {"handlers": ["console"], "level": "INFO"},
        "celery": {"handlers": ["console"], "level": "INFO"},
    },
}
