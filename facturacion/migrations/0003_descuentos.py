import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('facturacion', '0002_auth'),
    ]

    operations = [
        migrations.CreateModel(
            name='Descuento',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('nombre', models.CharField(max_length=120)),
                ('tipo', models.CharField(choices=[('porcentual', 'porcentual'), ('fijo', 'fijo')], max_length=20)),
                ('valor', models.PositiveIntegerField()),
            ],
            options={
                'db_table': 'descuentos',
            },
        ),
        migrations.AddField(
            model_name='venta',
            name='descuento',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='facturacion.descuento'),
        ),
        migrations.AddField(
            model_name='venta',
            name='descuento_nombre',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='venta',
            name='descuento_tipo',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='venta',
            name='descuento_valor',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='venta',
            name='descuento_monto',
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddConstraint(
            model_name='descuento',
            constraint=models.CheckConstraint(condition=models.Q(('tipo__in', ['porcentual', 'fijo'])), name='descuento_tipo_valido'),
        ),
        migrations.AddConstraint(
            model_name='descuento',
            constraint=models.CheckConstraint(condition=models.Q(('valor__gt', 0)), name='descuento_valor_positivo'),
        ),
        migrations.AddConstraint(
            model_name='descuento',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('tipo', 'porcentual'), _negated=True), ('valor__lte', 100), _connector='OR'), name='descuento_porcentual_max_100'),
        ),
        migrations.AddConstraint(
            model_name='venta',
            constraint=models.CheckConstraint(condition=models.Q(('descuento_monto__lte', models.F('subtotal'))), name='venta_descuento_no_mayor_subtotal'),
        ),
    ]
