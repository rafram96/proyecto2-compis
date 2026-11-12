"""Integración HTTP → proceso real → Polars → archivo. Sin mocks del runtime."""
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
import os
import socket
import httpx
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from fastapi.testclient import TestClient
import polars as pl
from etl_dsl import compile_program, parse
from etl_dsl.runtime import PolarsRuntime
from service.app import create_app
from service.catalog import Catalog, ROOT
from service.config import Settings
from service.jobs.repository import Repository
from service.prepare import prepare
from service.runner.serialization import cell
from service.schemas import Run, RunRequest

JOIN = (ROOT / 'demo/joins.etl').read_text()
INPUT = 'PIPELINE p { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; OUTPUT o: TABLE; FLOW { i -> o; } }'


def binding(pipeline='p', declaration='i', dataset='orders', version='1'):
    return dict(pipeline=pipeline, declaration=declaration, dataset_id=dataset, version=version)


def request(source=INPUT, pipeline='p', bindings=None, passes=None):
    return dict(source=source, filename='test.etl', document_id='document-1', revision=3,
                pipeline=pipeline, bindings=[binding()] if bindings is None else bindings, passes=passes)


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_temp = tempfile.TemporaryDirectory()
        cls.datasets = Path(cls.data_temp.name)
        prepare(cls.datasets)

    @classmethod
    def tearDownClass(cls):
        cls.data_temp.cleanup()

    @contextmanager
    def client(self, **limits):
        with tempfile.TemporaryDirectory() as temp:
            settings = replace(Settings(storage=Path(temp), datasets=self.datasets), **limits)
            app = create_app(settings)
            with TestClient(app) as client:
                yield client, app.state.manager, settings

    def accept(self, client, body=None):
        response = client.post('/api/v1/runs', json=body or request())
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def finish(self, client, run):
        until = time.monotonic() + 10
        while time.monotonic() < until:
            r = client.get(run['status_url']).json()
            if r['state'] not in ('queued', 'running'):
                Run.model_validate(r)
                return r
            time.sleep(.03)
        self.fail('El proceso no terminó en 10 segundos.')

    def preview(self, client, run, index=0, **params):
        output = run['outputs'][index]
        response = client.get(f"{run['status_url']}/outputs/{output['id']}/preview", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_http_models_health_capabilities_and_openapi(self):
        with self.client() as (c, manager, settings):
            self.assertEqual(c.get('/api/v1/health').json(), {'status': 'ok', 'contract_version': '1'})
            caps = c.get('/api/v1/capabilities').json()
            self.assertEqual(caps['analysis_version'], '4')
            self.assertEqual(caps['contract_version'], '1')
            self.assertEqual(caps['default_passes'], ['constantes', 'rangos', 'filtros', 'joins', 'muertos'])
            self.assertNotIn('SQLITE', caps['sink_connectors'])
            self.assertTrue(all(d['available'] for d in caps['datasets']))
            self.assertNotIn(str(self.datasets), json.dumps(caps))
            self.assertEqual(len(c.get('/openapi.json').json()['paths']), 7)
            for bad in [{**request(), 'python': 'print(1)'}, {**request(), 'passes': ['bad']},
                        {**request(), 'revision': '3'}, {**request(), 'filename': '/tmp/a.etl'},
                        {**request(), 'source': '😀' * 40000}]:
                response = c.post('/api/v1/runs', json=bad)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn('print(1)', response.text)
            self.assertEqual(c.post('/api/v1/runs', content=b'x' * (193 * 1024)).status_code, 413)
            self.assertEqual(c.post('/api/v1/runs', json=request(), headers={'origin': 'https://untrusted.test'}).status_code, 403)

    def test_catalog_missing_generated_data_and_immutable_preparation(self):
        with tempfile.TemporaryDirectory() as temp:
            catalog = Catalog(temp)
            available = {e.id for e in catalog.list() if e.available}
            self.assertEqual(available, {'join-orders', 'join-customers'})
            with self.client(datasets=Path(temp)) as (c, _, _):
                self.assertEqual(c.post('/api/v1/runs', json=request()).status_code, 422)
            prepare(temp)
            before = {p.name: p.read_bytes() for p in Path(temp).iterdir()}
            prepare(temp)
            self.assertEqual(before, {p.name: p.read_bytes() for p in Path(temp).iterdir()})
            (Path(temp) / 'orders.csv').write_text('different')
            with self.assertRaisesRegex(ValueError, 'distinto'):
                prepare(temp)
            with self.assertRaisesRegex(ValueError, 'ausente o modificado'):
                Catalog(temp).resolve('orders', '1')

    def test_binding_validation_version_completeness_duplicates_and_connectors(self):
        source = 'PIPELINE p { SOURCE i = SQLITE(file: "bank.db", table: "customers"); OUTPUT o: TABLE; FLOW { i -> o; } }'
        with self.client() as (c, _, _):
            for bindings in [[], [binding(), binding()], [binding(dataset='unknown')], [binding(version='2')],
                             [binding(pipeline='other')], [binding(declaration='other')]]:
                self.assertEqual(c.post('/api/v1/runs', json=request(bindings=bindings)).status_code, 422)
            self.assertEqual(c.post('/api/v1/runs', json=request(source, bindings=[binding(dataset='bank-clients')])).status_code, 422)
            self.assertEqual(c.post('/api/v1/runs', json=request(pipeline='missing')).status_code, 422)
            self.assertEqual(c.post('/api/v1/runs', json=request(source, bindings=[binding(dataset='orders')])).status_code, 422)
            custom_csv = source.replace('SQLITE(file: "bank.db", table: "customers")', 'CSV(file: "orders.csv", delimiter: ";")')
            self.assertEqual(c.post('/api/v1/runs', json=request(custom_csv)).status_code, 422)

    def test_server_recompilation_passes_and_precision_preserving_output(self):
        source = 'PIPELINE p { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; STEP d = DERIVE { precise = 0.1 + 0.2; huge = 9007199254740993; } OUTPUT o: TABLE; FLOW { i -> d -> o; } }'
        with self.client() as (c, _, _):
            for passes in (None, [], ['muertos', 'constantes', 'rangos'], ['joins', 'joins']):
                run = self.finish(c, self.accept(c, request(source, passes=passes)))
                self.assertEqual(run['state'], 'succeeded', run)
                self.assertEqual(run['passes'], passes)
                self.assertEqual(run['effective_passes'], passes if passes is not None else ['constantes', 'rangos', 'filtros', 'joins', 'muertos'])
                self.assertEqual(self.preview(c, run)['rows'][0][-2:], ['0.3', '9007199254740993'])
                self.assertEqual(run['revision'], 3)
                self.assertIsNotNone(run['metrics']['worker_seconds'])
                self.assertGreater(run['metrics']['peak_rss_bytes'], 0)

    def test_source_input_output_use_and_multiple_outputs(self):
        source = '''PIPELINE p { SOURCE s = CSV(file: "logical.csv"); USE clean AS u;
 OUTPUT raw: TABLE; OUTPUT processed: TABLE;
 FLOW { s -> raw; s -> u.i; u.o -> processed; } }
 PIPELINE clean { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; SOURCE other = SQLITE(file: "bank.db", table: "customers");
 STEP f = FILTER { WHERE amount > 20; } OUTPUT o: TABLE; OUTPUT extra: TABLE;
 FLOW { i -> f -> o; other -> extra; } }'''
        bindings = [binding(declaration='s'), binding('clean', 'other', 'bank-customers')]
        with self.client() as (c, _, _):
            self.assertEqual(c.post('/api/v1/runs', json=request(source, bindings=bindings[:1])).status_code, 422)
            self.assertEqual(c.post('/api/v1/runs', json=request(source, bindings=bindings + [binding('clean', 'i')])).status_code, 422)
            run = self.finish(c, self.accept(c, request(source, bindings=bindings)))
            self.assertEqual(run['state'], 'succeeded', run)
            rows = {o['declaration']: self.preview(c, run, i)['rows'] for i, o in enumerate(run['outputs'])}
            self.assertEqual(len(rows['raw']), 3)
            self.assertEqual(rows['processed'], [[3, 9, 30.0, 'pending']])
            self.assertEqual(len(run['artifacts']), 2)

    def test_all_curated_valid_pipelines_execute_and_input_pipeline_alone(self):
        cases = [('web/scripts/programs/ventas.etl', 'ventas', [binding('ventas', 'pedidos')], 2),
                 ('input/credit_risk.etl', 'credit_risk', [binding('credit_risk', 'clients', 'bank-clients')], 2),
                 ('input/credit_risk.etl', 'order_report', [binding('order_report', 'raw_orders'), binding('order_report', 'customers', 'bank-customers')], 3),
                 ('input/credit_risk.etl', 'clean_orders', [binding('clean_orders', 'orders')], 3),
                 ('demo/rangos.etl', 'rangos', [binding('rangos', 'ventas', 'ranges-sales')], 2)]
        with self.client() as (c, _, _):
            for path, pipeline, bindings, rows in cases:
                run = self.finish(c, self.accept(c, request((ROOT / path).read_text(), pipeline, bindings)))
                self.assertEqual(run['state'], 'succeeded', run)
                self.assertEqual(self.preview(c, run)['total_rows'], rows)

    def test_sink_download_matches_unadapted_runtime_and_join_obligations_in_o0(self):
        with self.client() as (c, _, _):
            for passes in (None, [], ['muertos', 'joins']):
                bindings = [binding('join_verificado', 'pedidos', 'join-orders'), binding('join_verificado', 'clientes', 'join-customers')]
                run = self.finish(c, self.accept(c, request(JOIN, 'join_verificado', bindings, passes)))
                self.assertEqual(run['state'], 'succeeded', run)
                self.assertEqual(self.preview(c, run)['rows'], [[2, 30], [1, 10], [2, 40]])
                with tempfile.TemporaryDirectory() as temp:
                    for name in ('joins_pedidos.csv', 'joins_clientes.csv'):
                        (Path(temp) / name).write_bytes((ROOT / 'demo' / name).read_bytes())
                    namespace = {'__name__': 'original'}
                    from etl_dsl.passes import DEFAULT
                    exec(compile_program(parse(JOIN), passes=DEFAULT if passes is None else passes), namespace)
                    with PolarsRuntime(temp) as rt:
                        namespace['PIPELINES']['join_verificado'](rt)
                    downloaded = c.get(f"{run['status_url']}/artifacts/{run['artifacts'][0]['id']}")
                    self.assertEqual(downloaded.content, (Path(temp) / 'joins_result.csv').read_bytes())
                bindings[1]['dataset_id'] = 'join-duplicates'
                failed = self.finish(c, self.accept(c, request(JOIN, 'join_verificado', bindings, passes)))
                self.assertEqual(failed['state'], 'failed')
                self.assertEqual(failed['diagnostics'][0]['code'], 'E_JOIN_UNIQUE')
                self.assertEqual(failed['artifacts'], [])

    def test_sink_formats_options_and_shared_duckdb_artifact_use_final_file(self):
        source = INPUT.replace('OUTPUT o: TABLE;', '''OUTPUT o: TABLE;
 SINK a = DUCKDB(file: "report.data", table: "a");
 SINK b = DUCKDB(file: "report.data", table: "b");
 SINK csv = CSV(file: "custom.data", header: FALSE, delimiter: ";", nullstr: "NULL");''').replace('i -> o;', 'i -> o; i -> a; i -> b; i -> csv;')
        with self.client() as (c, _, _):
            run = self.finish(c, self.accept(c, request(source)))
            self.assertEqual(run['state'], 'succeeded', run)
            self.assertEqual(len(run['outputs']), 4)
            self.assertEqual(len(run['artifacts']), 3)
            outputs = {o['declaration']: o for o in run['outputs']}
            self.assertEqual(outputs['a']['artifact_id'], outputs['b']['artifact_id'])
            artifacts = {a['id']: a for a in run['artifacts']}
            csv = artifacts[outputs['csv']['artifact_id']]
            self.assertEqual(csv['media_type'], 'text/csv')
            self.assertEqual(c.get(f"{run['status_url']}/artifacts/{csv['id']}").content,
                             b'1;1;10.5;paid\n2;2;NULL;NULL\n3;9;30.0;pending\n')
            aid = outputs['a']['artifact_id']
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / 'result.duckdb'
                path.write_bytes(c.get(f"{run['status_url']}/artifacts/{aid}").content)
                import duckdb
                with duckdb.connect(str(path), read_only=True) as db:
                    self.assertEqual(db.execute('select count(*) from a').fetchone(), (3,))
                    self.assertEqual(db.execute('select count(*) from b').fetchone(), (3,))

    def test_empty_output_dynamic_contract_and_static_diagnostics(self):
        empty = 'PIPELINE p { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; STEP f = FILTER { WHERE amount > 1000; } OUTPUT o: TABLE; FLOW { i -> f -> o; } }'
        with self.client() as (c, _, _):
            run = self.finish(c, self.accept(c, request(empty)))
            self.assertEqual(run['state'], 'succeeded')
            self.assertEqual(self.preview(c, run)['rows'], [])
            self.assertEqual([col['name'] for col in self.preview(c, run)['columns']], ['id', 'customer_id', 'amount', 'status'])
            bad_contract = INPUT.replace('INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?];', 'INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL, status: STRING];')
            run = self.finish(c, self.accept(c, request(bad_contract)))
            self.assertEqual(run['diagnostics'][0]['code'], 'E_NULL')
            bad = self.finish(c, self.accept(c, request('PIPELINE p { STEP f = FILTRO { WHERE x > 0; } }')))
            self.assertEqual(bad['state'], 'failed')
            self.assertEqual(bad['diagnostics'][0]['phase'], 'syntax')
            self.assertIsNotNone(bad['diagnostics'][0]['span'])
            self.assertNotIn(str(ROOT), json.dumps(bad))

    def test_paths_nested_use_identifiers_and_symlinks_are_denied(self):
        with self.client() as (c, manager, settings):
            for path in ('/etc/passwd', '../escape.csv', 'https://example.com/data.csv', 'a\\b.csv'):
                source = f'PIPELINE p {{ SOURCE i = CSV(file: {json.dumps(path)}); SINK s = CSV(file: "ok.csv"); FLOW {{ i -> s; }} }}'
                self.assertEqual(c.post('/api/v1/runs', json=request(source)).status_code, 422)
                source = INPUT.replace('OUTPUT o: TABLE;', f'SINK o = CSV(file: {json.dumps(path)});')
                self.assertEqual(c.post('/api/v1/runs', json=request(source)).status_code, 422)
            nested = 'PIPELINE p { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; USE inner AS u; OUTPUT o: TABLE; FLOW { i -> u.i; u.o -> o; } } PIPELINE inner { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; SINK bad = CSV(file: "../escape"); OUTPUT o: TABLE; FLOW { i -> bad; i -> o; } }'
            self.assertEqual(c.post('/api/v1/runs', json=request(nested)).status_code, 422)
            self.assertEqual(c.get('/api/v1/runs/invalid').status_code, 404)
            run = self.finish(c, self.accept(c))
            self.assertEqual(c.get(run['status_url'] + '/artifacts/request.json').status_code, 404)
            self.assertEqual(c.get(run['status_url'] + '/artifacts/unknown').status_code, 404)
            record, private = manager.repository.get(run['id'])
            aid = run['artifacts'][0]['id']
            file = settings.storage / run['id'] / private[aid]
            file.unlink()
            file.symlink_to(ROOT / 'README.md')
            self.assertEqual(c.get(f"{run['status_url']}/artifacts/{aid}").status_code, 404)

    def test_queue_concurrency_cancellation_and_capacity(self):
        with self.client() as (c, manager, _):
            # Congelar solo el scheduler para admitir una cola determinista; el proceso sigue siendo real.
            with manager.lock:
                runs = []
                for _ in range(5):
                    runs.append(manager.submit(RunRequest.model_validate(request())))
                with self.assertRaisesRegex(ValueError, 'Capacidad'):
                    manager.submit(RunRequest.model_validate(request()))
            deadline = time.monotonic() + 3
            while c.get(runs[0]['status_url']).json()['state'] == 'queued' and time.monotonic() < deadline:
                time.sleep(.01)
            first = c.get(runs[0]['status_url']).json()
            self.assertEqual(first['state'], 'running')
            self.assertEqual(len(manager.processes), 1)
            queued = c.post(runs[-1]['status_url'] + '/cancel').json()
            self.assertEqual(queued['state'], 'cancelled')
            pid = next(iter(manager.processes.values()))[0].pid
            cancelled = c.post(runs[0]['status_url'] + '/cancel').json()
            self.assertEqual(cancelled['state'], 'cancelled')
            import psutil
            self.assertFalse(psutil.pid_exists(pid))
            self.assertEqual(c.post(runs[0]['status_url'] + '/cancel').json()['state'], 'cancelled')
            for run in runs[1:-1]:
                self.assertEqual(self.finish(c, run)['state'], 'succeeded')

    def test_http_capacity_and_unavailable_errors(self):
        with self.client(max_jobs=1) as (c, manager, _):
            self.accept(c)
            self.assertEqual(c.post('/api/v1/runs', json=request()).status_code, 429)
            manager.stopping.set()
            self.assertEqual(c.post('/api/v1/runs', json=request()).status_code, 503)
            self.assertEqual(c.get('/api/v1/health').status_code, 503)

    def test_timeout_memory_and_output_limits_are_effective(self):
        for limits, expected in [({'timeout_seconds': .01}, 'timed_out'),
                                 ({'memory_bytes': 1}, 'failed'), ({'max_rows': 1}, 'failed'),
                                 ({'input_bytes': 1}, 'rejected')]:
            with self.client(**limits) as (c, manager, settings):
                if expected == 'rejected':
                    self.assertEqual(c.post('/api/v1/runs', json=request()).status_code, 422)
                    continue
                run = self.finish(c, self.accept(c))
                self.assertEqual(run['state'], expected, run)
                self.assertFalse((settings.storage / run['id']).exists())
                self.assertEqual(len(manager.processes), 0)

    def test_missing_file_after_acceptance_is_a_failed_program(self):
        with tempfile.TemporaryDirectory() as temp:
            prepare(temp)
            with self.client(datasets=Path(temp)) as (c, manager, _):
                with manager.lock:
                    run = manager.submit(RunRequest.model_validate(request()))
                    (Path(temp) / 'orders.csv').unlink()
                result = self.finish(c, run)
                self.assertEqual(result['state'], 'failed')
                self.assertEqual(result['diagnostics'][0]['code'], 'E_DATASET_UNAVAILABLE')

    def test_expiry_tombstones_and_metadata_cleanup(self):
        with self.client(ttl_seconds=.2) as (c, manager, settings):
            run = self.finish(c, self.accept(c))
            artifact = run['artifacts'][0]['id']
            time.sleep(.23)
            self.assertTrue(c.get(run['status_url']).json()['expired'])
            self.assertEqual(c.get(f"{run['status_url']}/artifacts/{artifact}").status_code, 410)
            self.assertEqual(c.get(f"{run['status_url']}/outputs/o0/preview").status_code, 410)
            self.assertFalse((settings.storage / run['id']).exists())
            time.sleep(.23)
            self.assertEqual(c.get(run['status_url']).status_code, 404)

    def test_restart_marks_interrupted_and_removes_orphans(self):
        with self.client() as (c, manager, settings):
            completed = self.finish(c, self.accept(c))
            # Simular metadatos durables dejados por un cierre abrupto sin tocar procesos ajenos.
            interrupted = {**completed, 'id': 'b' * 32, 'state': 'running', 'outputs': [], 'artifacts': []}
            interrupted.update(status_url='/api/v1/runs/' + interrupted['id'], finished_at=None, expires_at=None)
            manager.close()
            manager.repository.put(interrupted, {})
            (settings.storage / interrupted['id']).mkdir()
            (settings.storage / 'orphan').mkdir()
            from service.jobs.manager import Manager
            replacement = Manager(settings, Catalog(self.datasets))
            try:
                r = replacement.get(interrupted['id'])[0]
                self.assertEqual(r['state'], 'failed')
                self.assertEqual(r['diagnostics'][0]['code'], 'E_INTERRUPTED')
                self.assertFalse((settings.storage / 'orphan').exists())
                self.assertEqual(replacement.get(completed['id'])[0]['state'], 'succeeded')
            finally:
                replacement.close()

    def test_serialization_special_values_and_paginated_schema(self):
        self.assertEqual(cell(Decimal('123.4500')), '123.4500')
        self.assertEqual(cell(2**64 - 1), str(2**64 - 1))
        self.assertEqual(cell(-2**53), str(-2**53))
        self.assertEqual(cell(date(2026, 11, 11)), '2026-11-11')
        self.assertEqual(cell(datetime(2026, 11, 11, 10)), '2026-11-11T10:00:00')
        self.assertEqual(cell(float('inf')), {'kind': 'non_finite', 'value': 'Infinity'})
        self.assertEqual(cell(float('nan'))['value'], 'NaN')
        self.assertIsNone(cell(None))
        with self.client() as (c, _, _):
            run = self.finish(c, self.accept(c))
            data = self.preview(c, run, offset=1, limit=1)
            self.assertEqual(data['rows'], [[2, 2, None, None]])
            self.assertEqual(data['total_rows'], 3)
            self.assertTrue(data['columns'][2]['nullable'])
            self.assertEqual(self.preview(c, run, offset=999)['rows'], [])
            for query in ('limit=101', 'offset=-1', 'limit=0'):
                self.assertEqual(c.get(f"{run['status_url']}/outputs/o0/preview?{query}").status_code, 422)

    def test_real_http_process_restart_kills_orphan_and_preserves_completed_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            env = {**os.environ, 'CAUCE_STORAGE': temp, 'CAUCE_DATASETS': str(self.datasets)}
            command = [sys.executable, '-m', 'uvicorn', 'service.app:app', '--host', '127.0.0.1', '--port', str(port), '--no-access-log']
            process = None
            def start():
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(150):
                    try:
                        if httpx.get(f'http://127.0.0.1:{port}/api/v1/health', timeout=.2).status_code == 200:
                            return child
                    except httpx.HTTPError:
                        pass
                    if child.poll() is not None:
                        self.fail('Uvicorn terminó durante startup')
                    time.sleep(.02)
                child.kill()
                child.wait()
                self.fail('Uvicorn no inició')
            try:
                process = start()
                with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=3) as c:
                    completed = self.finish(c, self.accept(c))
                    interrupted = self.accept(c)
                    for _ in range(100):
                        item = c.get(interrupted['status_url']).json()
                        if item['state'] == 'running':
                            break
                        time.sleep(.005)
                    self.assertEqual(item['state'], 'running')
                    private = Repository(Path(temp) / 'jobs.sqlite3').get(interrupted['id'])[1]
                    orphan_pid = private['pid']
                    process.kill()
                    process.wait(timeout=5)
                    process = start()
                    recovered = c.get(interrupted['status_url']).json()
                    self.assertEqual(recovered['state'], 'failed')
                    self.assertEqual(recovered['diagnostics'][0]['code'], 'E_INTERRUPTED')
                    self.assertEqual(c.get(completed['status_url']).json()['state'], 'succeeded')
                    self.assertEqual(c.get(f"{completed['status_url']}/outputs/o0/preview").status_code, 200)
                    import psutil
                    self.assertFalse(psutil.pid_exists(orphan_pid) and psutil.Process(orphan_pid).status() != psutil.STATUS_ZOMBIE)
            finally:
                if process is not None and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)

    def test_http_preview_preserves_special_types_without_json_nan_or_precision_loss(self):
        with self.client() as (c, manager, settings):
            run = self.finish(c, self.accept(c))
            frame = pl.DataFrame({
                'huge': [2**63 - 1, None],
                'decimal': [Decimal('123.4500'), None],
                'day': [date(2026, 11, 11), None],
                'stamp': [datetime(2026, 11, 11, 10, 5, 3), None],
                'value': [float('nan'), float('-inf')],
                'duration': [timedelta(seconds=2), None],
                'binary': [b'abc', None],
            })
            with manager.lock:
                r, private = manager.repository.get(run['id'])
                path = settings.storage / run['id'] / private['o0']
                frame.write_ipc(path)
                r['outputs'][0].update(rows=2, columns=[dict(name=n, dtype=str(t), nullable=True, declared_nullable=None) for n, t in frame.schema.items()])
                manager.repository.put(r, private)
            response = c.get(run['status_url'] + '/outputs/o0/preview')
            self.assertEqual(response.status_code, 200)
            cells = response.json()['rows'][0]
            self.assertEqual(cells[:4], [str(2**63 - 1), '123.4500', '2026-11-11', '2026-11-11T10:05:03'])
            self.assertEqual(cells[4], dict(kind='non_finite', value='NaN'))
            self.assertEqual(cells[5], dict(kind='duration', value='0:00:02'))
            self.assertEqual(cells[6], dict(kind='binary', value='YWJj'))
            self.assertEqual(response.json()['rows'][1][:4], [None] * 4)

    def test_static_build_fallback_preserves_asset_and_api_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'index.html').write_text('SPA')
            (root / 'asset.js').write_text('JS')
            (root / 'evidencia/c5').mkdir(parents=True)
            (root / 'evidencia/c5/summary.csv').write_text('a,b\n')
            with self.client(static=root) as (c, _, _):
                for route in ('/', '/estudio', '/docs', '/ejemplos', '/docs/conectores', '/ejemplos/ventas', '/evaluacion'):
                    self.assertEqual(c.get(route).text, 'SPA')
                # Enlaces internos con consulta: /estudio?vista=… y valores inválidos también reciben la SPA.
                for route in ('/estudio?vista=ir', '/estudio?vista=ejecucion', '/estudio?vista=desconocida&x=1',
                              '/evaluacion?fase=ejecucion&workload=join'):
                    response = c.get(route)
                    self.assertEqual((response.status_code, response.text), (200, 'SPA'), route)
                for route in ('/api/v1/missing?vista=ir', '/assets/missing.js?vista=ir', '/evidencia/c5/ausente.csv?x=1'):
                    self.assertEqual(c.get(route).status_code, 404, route)
                self.assertEqual(c.get('/evidencia/c5/summary.csv?vista=ir').text, 'a,b\n')
                for route in ('/api/missing', '/api/v1/missing', '/assets/missing.js', '/py/missing.whl',
                              '/evidencia/c5/ausente.csv', '/evidencia/c5', '/evidencia/otra'):
                    self.assertEqual(c.get(route).status_code, 404, route)
                self.assertEqual(c.get('/asset.js').text, 'JS')
                self.assertEqual(c.get('/evidencia/c5/summary.csv').text, 'a,b\n')


if __name__ == '__main__':
    unittest.main()
