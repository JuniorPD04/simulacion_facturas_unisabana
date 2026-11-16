import os
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from facturacion.models import SeedHistory, Usuario
from facturacion.services import lock_writes


class Command(BaseCommand):
    help = 'Carga sql/seed.sql y los usuarios iniciales una única vez, sin sobrescribir datos existentes.'

    @transaction.atomic
    def handle(self, *args, **options):
        lock_writes()
        if SeedHistory.objects.filter(pk='initial-v1').exists():
            self.stdout.write('Seed ya aplicado; se conservan tus datos.')
        else:
            with connection.cursor() as cursor:
                cursor.execute((settings.BASE_DIR / 'sql' / 'seed.sql').read_text(encoding='utf-8'))
            self.stdout.write(self.style.SUCCESS('Datos de ejemplo cargados.'))
        self.seed_users()

    def seed_users(self):
        if SeedHistory.objects.filter(pk='usuarios-v1').exists():
            self.stdout.write('Usuarios iniciales ya cargados; se conservan tus datos.')
            return
        for username_var, password_var, default_user, default_password, rol in (
            ('SEED_ADMIN_USER', 'SEED_ADMIN_PASSWORD', 'admin', 'admin123', 'administrador'),
            ('SEED_CAJERO_USER', 'SEED_CAJERO_PASSWORD', 'cajero', 'cajero123', 'cajero'),
        ):
            usuario = Usuario(usuario=os.getenv(username_var, default_user), rol=rol)
            usuario.set_password(os.getenv(password_var, default_password))
            usuario.save()
        SeedHistory.objects.create(version='usuarios-v1')
        self.stdout.write(self.style.SUCCESS('Usuarios iniciales creados (administrador y cajero).'))
