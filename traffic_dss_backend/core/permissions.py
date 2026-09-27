from rest_framework.permissions import BasePermission, SAFE_METHODS


def user_role(user):
    if not user or not user.is_authenticated:
        return None
    if user.is_staff or user.is_superuser:
        return "administrator"
    if user.groups.filter(name="supervisor").exists():
        return "supervisor"
    return "dispatcher"


class IsSupervisor(BasePermission):
    def has_permission(self, request, view):
        return user_role(request.user) in {"supervisor", "administrator"}


class SupervisorWrite(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and (
            request.method in SAFE_METHODS or user_role(request.user) in {"supervisor", "administrator"}
        ))
