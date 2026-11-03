from django.db import IntegrityError
from django.db.models.deletion import ProtectedError
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler


class Conflict(APIException):
    status_code = 409
    default_detail = 'El registro ya existe o tiene referencias asociadas.'


def exception_handler(exc, context):
    if isinstance(exc, (ProtectedError, IntegrityError)):
        return Response({'success': False, 'message': 'Conflicto: registro duplicado o con referencias asociadas.'}, status=409)
    response = drf_handler(exc, context)
    if response is not None:
        response.data = {'success': False, 'message': 'Datos inválidos.' if response.status_code == 400 else str(getattr(exc, 'detail', 'Error en la solicitud.')), 'errors': response.data}
    return response
