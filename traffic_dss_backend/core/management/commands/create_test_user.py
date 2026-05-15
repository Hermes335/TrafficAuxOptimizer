from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

User = get_user_model()


class Command(BaseCommand):
    help = 'Create a test account for the Traffic Deployment DSS'

    def add_arguments(self, parser):
        parser.add_argument('--username', type=str, default='admin', help='Username')
        parser.add_argument('--password', type=str, default='admin123', help='Password')
        parser.add_argument('--badge', type=str, default='1001', help='Badge number')
        parser.add_argument('--role', type=str, default='supervisor', choices=['dispatcher', 'supervisor', 'administrator'], help='User role')
        parser.add_argument('--shift', type=str, default='afternoon', choices=['morning', 'afternoon'], help='Shift (morning or afternoon)')

    def handle(self, *args, **options):
        username = options['username']
        password = options['password']
        badge = options['badge']
        role = options['role']
        shift = options['shift']

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                'is_staff': role == 'administrator',
                'is_superuser': role == 'administrator',
            }
        )
        user.set_password(password)
        user.save()

        # Create or update officer profile and link to user
        from core.models import Officer
        officer, officer_created = Officer.objects.get_or_create(
            badge_number=badge,
            defaults={
                'name': username.title(),
                'status': 'available',
                'shift': shift,
                'user': user,
            }
        )
        # Update user link if officer already exists
        if not officer_created and officer.user != user:
            officer.user = user
            officer.save()

        if created:
            self.stdout.write(self.style.SUCCESS(f'Created user: {username}'))
        else:
            self.stdout.write(self.style.WARNING(f'User already exists: {username}'))

        self.stdout.write(self.style.SUCCESS(f'Password set: {password}'))
        self.stdout.write(f'Badge: {badge}')
        self.stdout.write(f'Role: {role}')
        self.stdout.write(f'Shift: {shift}')
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('Login credentials:'))
        self.stdout.write(f'  Username: {username}')
        self.stdout.write(f'  Password: {password}')