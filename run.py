"""Arranque local: entorno virtual, dependencias, PostgreSQL, migraciones y seed."""
import argparse
import getpass
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def bootstrap():
    executable = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        if not executable.exists():
            print('Creando entorno virtual...', flush=True)
            venv.create(ROOT / '.venv', with_pip=True)
        return subprocess.call([str(executable), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=ROOT)
    marker = ROOT / '.venv' / '.requirements-installed'
    requirements = (ROOT / 'requirements.lock.txt').read_text(encoding='utf-8')
    if not marker.exists() or marker.read_text(encoding='utf-8') != requirements:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.lock.txt')], check=True)
        marker.write_text(requirements, encoding='utf-8')
    return None


def prepare_database():
    import psycopg
    from psycopg import sql

    config = dict(user=os.getenv('DB_USER', 'postgres'), password=os.getenv('DB_PASSWORD', ''),
                  host=os.getenv('DB_HOST', '127.0.0.1'), port=os.getenv('DB_PORT', '5432'), connect_timeout=5)
    if not config['password'] and sys.stdin.isatty():
        config['password'] = getpass.getpass('Contraseña PostgreSQL (Enter si no requiere): ')
        os.environ['DB_PASSWORD'] = config['password']
    database = os.getenv('DB_NAME', 'papel_y_luna')
    try:
        conn = psycopg.connect(dbname=database, **config)
    except psycopg.OperationalError as original:
        with psycopg.connect(dbname=os.getenv('DB_ADMIN_NAME', 'postgres'), autocommit=True, **config) as admin:
            if admin.execute('SELECT 1 FROM pg_database WHERE datname = %s', (database,)).fetchone():
                raise original
            admin.execute(sql.SQL("CREATE DATABASE {} ENCODING 'UTF8' TEMPLATE template0").format(sql.Identifier(database)))
        conn = psycopg.connect(dbname=database, **config)
    with conn:
        if conn.info.server_version // 10000 != 18:
            raise RuntimeError('Este proyecto requiere PostgreSQL 18. Revisa DB_HOST y DB_PORT en .env.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Prepara y verifica sin iniciar el servidor.')
    parser.add_argument('--no-seed', action='store_true', help='No cargar datos de ejemplo.')
    args = parser.parse_args()
    status = bootstrap()
    if status is not None:
        return status
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    prepare_database()
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    import django
    django.setup()
    from django.core.management import call_command
    call_command('migrate', interactive=False, fake_initial=True)
    if not args.no_seed:
        call_command('seed')
    call_command('check')
    if not args.check:
        host, port = os.getenv('HOST', '127.0.0.1'), os.getenv('PORT', '8000')
        print(f'Frontend y API: http://{host}:{port}', flush=True)
        call_command('runserver', f'{host}:{port}', use_reloader=False)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\nServicio detenido.')
    except Exception as exc:
        print(f'No se pudo iniciar ({type(exc).__name__}). Revisa .env, PostgreSQL 18 y los permisos CREATE DATABASE. Consulta README.md.', file=sys.stderr)
        sys.exit(1)
