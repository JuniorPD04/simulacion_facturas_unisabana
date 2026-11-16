import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('facturacion', '0003_descuentos'),
    ]

    operations = [
        migrations.AddField(
            model_name='venta',
            name='corregida',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='venta',
            name='corregida_en',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='venta',
            name='corregida_por_nombre',
            field=models.CharField(blank=True, default='', max_length=60),
        ),
        migrations.AddField(
            model_name='venta',
            name='corregida_por',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='facturacion.usuario'),
        ),
    ]
