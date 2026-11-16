import django.db.models.deletion
import django.db.models.functions.text
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('facturacion', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Usuario',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('usuario', models.CharField(max_length=60)),
                ('password_hash', models.CharField(max_length=255)),
                ('rol', models.CharField(choices=[('administrador', 'administrador'), ('cajero', 'cajero')], max_length=20)),
            ],
            options={
                'db_table': 'usuarios',
            },
        ),
        migrations.CreateModel(
            name='Sesion',
            fields=[
                ('token', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('creado_en', models.DateTimeField(auto_now_add=True)),
                ('expira_en', models.DateTimeField()),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sesiones', to='facturacion.usuario')),
            ],
            options={
                'db_table': 'sesiones',
            },
        ),
        migrations.AddField(
            model_name='requestlog',
            name='usuario',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='facturacion.usuario'),
        ),
        migrations.AddConstraint(
            model_name='usuario',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('usuario'), name='usuario_login_unico'),
        ),
        migrations.AddConstraint(
            model_name='usuario',
            constraint=models.CheckConstraint(condition=models.Q(('rol__in', ['administrador', 'cajero'])), name='usuario_rol_valido'),
        ),
    ]
