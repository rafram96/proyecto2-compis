from datetime import date, datetime, time, timedelta
from decimal import Decimal
import base64
import math


def cell(value):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return str(value) if abs(value) > 2**53 - 1 else value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return {'kind': 'non_finite', 'value': 'NaN' if math.isnan(value) else 'Infinity' if value > 0 else '-Infinity'}
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return {'kind': 'duration', 'value': str(value)}
    if isinstance(value, bytes):
        return {'kind': 'binary', 'value': base64.b64encode(value).decode('ascii')}
    raise ValueError('Tipo de celda no soportado en la vista previa.')
