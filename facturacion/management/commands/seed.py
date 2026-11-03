from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from facturacion.models import SeedHistory
from facturacion.services import lock_writes


class Command(BaseCommand):
    help = 'Carga sql/seed.sql una única vez, sin sobrescribir datos existentes.'

    @transaction.atomic
    def handle(self, *args, **options):
        lock_writes()
        if SeedHistory.objects.filter(pk='initial-v1').exists():
            self.stdout.write('Seed ya aplicado; se conservan tus datos.')
            return
        with connection.cursor() as cursor:
            cursor.execute((settings.BASE_DIR / 'sql' / 'seed.sql').read_text(encoding='utf-8'))
        self.stdout.write(self.style.SUCCESS('Datos de ejemplo cargados.'))
