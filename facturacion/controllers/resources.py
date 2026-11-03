from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion import services
from facturacion.serializers import record_json


class ResourceListController(APIView):
    def get(self, request, resource):
        model, _ = services.resource_config(resource)
        records = model.objects.order_by('pk')
        if resource in ('ventas', 'compras'):
            records = records.prefetch_related('items')
        return Response({'success': True, 'data': [record_json(row) for row in records]})

    def post(self, request, resource):
        record, created = services.save_record(resource, request.data)
        return Response({'success': True, 'data': record_json(record)}, status=201 if created else 200)


class ResourceDetailController(APIView):
    def get(self, request, resource, pk):
        model, _ = services.resource_config(resource)
        return Response({'success': True, 'data': record_json(services.get_record(model, pk))})

    def put(self, request, resource, pk):
        return self.save(request, resource, pk, partial=False)

    def patch(self, request, resource, pk):
        return self.save(request, resource, pk, partial=True)

    def save(self, request, resource, pk, partial):
        record, _ = services.save_record(resource, request.data, pk, partial)
        return Response({'success': True, 'data': record_json(record)})

    def delete(self, request, resource, pk):
        services.delete_record(resource, pk)
        return Response({'success': True, 'data': {'id': str(pk)}})
