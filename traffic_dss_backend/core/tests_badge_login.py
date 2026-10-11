import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from core.models import Officer

pytestmark = pytest.mark.django_db


@pytest.fixture
def badge_account():
    cache.clear()
    user = get_user_model().objects.create_user(
        username="officer.alex", password="correct-password"
    )
    group, _ = Group.objects.get_or_create(name="supervisor")
    user.groups.add(group)
    officer = Officer.objects.create(
        user=user, name="Officer Alex", badge_number="ICT-0042", shift="morning"
    )
    return user, officer


def login(identifier, password="correct-password"):
    return APIClient().post(
        "/api/auth/login/", {"username": identifier, "password": password}, format="json"
    )


@pytest.mark.parametrize("identifier", ["officer.alex", "ICT-0042", "  ICT-0042  "])
def test_username_and_badge_authenticate_the_same_account(badge_account, identifier):
    user, officer = badge_account
    response = login(identifier)
    assert response.status_code == 200
    assert response.data["user"]["id"] == user.id
    assert response.data["user"]["username"] == user.username
    assert response.data["user"]["badge_number"] == officer.badge_number
    assert response.data["user"]["role"] == "supervisor"
    assert response.data["user"]["shift"] == "morning"
    assert str(AccessToken(response.data["access"])["user_id"]) == str(user.id)
    assert response.data["refresh"]


@pytest.mark.parametrize("identifier", ["officer.alex", "ICT-0042", "UNKNOWN-BADGE"])
def test_wrong_password_or_unknown_badge_does_not_issue_tokens(badge_account, identifier):
    response = login(identifier, "wrong-password")
    assert response.status_code == 401
    assert response.data == {"detail": "Invalid credentials."}


@pytest.mark.parametrize("unusable", ["deleted", "unlinked", "inactive"])
def test_badge_requires_an_active_account_and_existing_profile(badge_account, unusable):
    user, officer = badge_account
    if unusable == "deleted":
        officer.is_deleted = True
        officer.save(update_fields=["is_deleted"])
    elif unusable == "unlinked":
        officer.user = None
        officer.save(update_fields=["user"])
    else:
        user.is_active = False
        user.save(update_fields=["is_active"])
    response = login(officer.badge_number)
    assert response.status_code == 401
    assert response.data == {"detail": "Invalid credentials."}


def test_existing_username_takes_priority_over_another_accounts_badge(badge_account):
    _, officer = badge_account
    username_owner = get_user_model().objects.create_user(
        username=officer.badge_number, password="username-owner-password"
    )
    response = login(officer.badge_number, "username-owner-password")
    assert response.status_code == 200
    assert response.data["user"]["id"] == username_owner.id
    # A failed username password must not silently select the badge owner instead.
    assert login(officer.badge_number).status_code == 401


@pytest.mark.parametrize("identifier,password", [
    (None, "correct-password"), (["ICT-0042"], "correct-password"),
    ({"badge": "ICT-0042"}, "correct-password"), (42, "correct-password"),
    ("ICT-0042", None), ("ICT-0042", ["correct-password"]),
    ("   ", "correct-password"), ("ICT-0042", ""),
])
def test_malformed_credentials_return_bad_request(badge_account, identifier, password):
    assert login(identifier, password).status_code == 400
