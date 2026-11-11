import fcntl
from hashlib import sha256
import json
import logging
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
from uuid import uuid4

import psutil
from etl_dsl import analyze, parse
from etl_dsl.backend import build_ir
from etl_dsl.passes import DEFAULT
from etl_dsl.version import COMPILER_VERSION, CONTRACT_VERSION
from service.catalog import ROOT
from service.runner.bindings import validate_bindings
from service.schemas import ACTIVE, Run
from .repository import Repository


class CapacityError(ValueError):
    pass


class Manager:
    def __init__(self, settings, catalog):
        self.settings, self.catalog = settings, catalog
        self.root = settings.storage.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lockfile = (self.root / 'manager.lock').open('a')
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lockfile.close()
            raise RuntimeError('Este almacenamiento ya tiene un gestor; use un único worker HTTP.')
        self.repository = Repository(self.root / 'jobs.sqlite3')
        self.lock = threading.RLock()
        self.processes = {}
        self.stopping = threading.Event()
        self.recover()
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def fail(self, r, code, message, state='failed'):
        r.update(state=state, finished_at=time.time(), expires_at=time.time() + self.settings.ttl_seconds,
                 outputs=[], artifacts=[], diagnostics=[dict(phase='runner', code=code, message=message,
                    filename=r['filename'], severity='error', span=None)])
        shutil.rmtree(self.root / r['id'], ignore_errors=True)
        self.repository.put(r, {})

    @staticmethod
    def kill(process):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)

    def recover(self):
        known = set()
        for r, private in self.repository.all():
            known.add(r['id'])
            if r['state'] in ACTIVE:
                # Nunca matar un PID reutilizado: verificar nacimiento y argv del worker.
                pid = private.get('pid')
                if pid:
                    try:
                        proc = psutil.Process(pid)
                        if proc.create_time() == private.get('birth') and str(self.root / r['id']) in proc.cmdline():
                            proc.kill()
                            try:
                                proc.wait(timeout=5)
                            except psutil.TimeoutExpired:
                                pass
                    except psutil.Error:
                        pass
                self.fail(r, 'E_INTERRUPTED', 'Trabajo interrumpido por el reinicio; vuelva a ejecutar.')
        for path in self.root.iterdir():
            if path.is_dir() and path.name not in known:
                shutil.rmtree(path)
        self.cleanup()

    def cleanup(self):
        now = time.time()
        for r, _ in self.repository.all():
            if r['expires_at'] is not None and now >= r['expires_at']:
                shutil.rmtree(self.root / r['id'], ignore_errors=True)
                # Mantener tombstone una hora adicional para contestar 410 de forma explícita.
                if now >= r['expires_at'] + self.settings.ttl_seconds:
                    self.repository.delete(r['id'])
                elif not r['expired']:
                    r.update(expired=True, outputs=[], artifacts=[])
                    self.repository.put(r, {})

    def submit(self, request):
        # Solo análisis acotado para validar opciones/enlaces. El runner recompila desde el fuente.
        analysis = analyze(request.source, filename=request.filename, passes=request.passes, artifacts=())
        hashes = {}
        if analysis.ok:
            original, _ = build_ir(parse(request.source), passes=())
            resolved, _ = validate_bindings(original, request, self.catalog, self.settings.input_bytes)
            hashes = {e.id: self.catalog.hashes[e.id] for e in resolved.values()}
        else:
            # Los errores de programa son estados failed del trabajo aceptado; el catálogo sigue validándose.
            for b in request.bindings:
                self.catalog.resolve(b.dataset_id, b.version)
        with self.lock:
            self.cleanup()
            records = self.repository.all()
            waiting = sum(r['state'] == 'queued' for r, _ in records)
            running = len(self.processes)
            disk = sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file())
            if waiting + running >= self.settings.active + self.settings.queue or len(records) >= self.settings.max_jobs or disk + (waiting + running + 1) * self.settings.work_bytes > self.settings.storage_bytes:
                raise CapacityError('Capacidad de la demo agotada; espere a que termine o caduque un trabajo.')
            run_id = uuid4().hex
            work = self.root / run_id
            work.mkdir(mode=0o700)
            for directory in ('inputs', 'files', 'previews'):
                (work / directory).mkdir(parents=True, exist_ok=True)
            payload = dict(request=request.model_dump(), datasets=str(self.catalog.directory), hashes=hashes,
                           timeout=self.settings.timeout_seconds, limits=vars(self.settings).copy())
            payload['limits'] = {k: v for k, v in payload['limits'].items() if not isinstance(v, Path)}
            (work / 'request.json').write_text(json.dumps(payload), encoding='utf-8')
            r = Run(id=run_id, compiler_version=COMPILER_VERSION, analysis_version=CONTRACT_VERSION,
                    status_url=f'/api/v1/runs/{run_id}', state='queued', document_id=request.document_id,
                    revision=request.revision, filename=request.filename, source_hash=sha256(request.source.encode()).hexdigest(),
                    pipeline=request.pipeline, passes=request.passes, effective_passes=list(DEFAULT if request.passes is None else request.passes),
                    bindings=request.bindings, dataset_hashes=hashes, created_at=time.time()).model_dump()
            self.repository.put(r, {})
            return r

    def get(self, run_id):
        with self.lock:
            self.cleanup()
            return self.repository.get(run_id)

    def cancel(self, run_id):
        with self.lock:
            item = self.repository.get(run_id)
            if item is None:
                return None
            r, _ = item
            if r['state'] in ACTIVE:
                if run_id in self.processes:
                    process, start, peak = self.processes.pop(run_id)
                    self.kill(process)
                    r['metrics'].update(worker_seconds=time.monotonic() - start, peak_rss_bytes=peak)
                self.fail(r, 'E_CANCELLED', 'Ejecución cancelada; el proceso ha terminado.', 'cancelled')
            return r

    def tick(self):
        with self.lock:
            self.cleanup()
            for run_id, (process, start, peak) in list(self.processes.items()):
                r, private = self.repository.get(run_id)
                elapsed = time.monotonic() - start
                try:
                    peak = max(peak, psutil.Process(process.pid).memory_info().rss)
                except psutil.Error:
                    pass
                self.processes[run_id] = (process, start, peak)
                exceeded = elapsed >= self.settings.timeout_seconds or peak > self.settings.memory_bytes
                disk = sum(p.stat().st_size for p in (self.root / run_id).rglob('*') if p.is_file())
                if disk > self.settings.work_bytes:
                    exceeded = True
                if exceeded or process.poll() is not None:
                    if exceeded:
                        self.kill(process)
                    else:
                        process.wait()
                    r['metrics'].update(worker_seconds=elapsed, peak_rss_bytes=peak)
                    del self.processes[run_id]
                    if exceeded:
                        timeout = elapsed >= self.settings.timeout_seconds
                        self.fail(r, 'E_TIMEOUT' if timeout else 'E_RESOURCE_LIMIT',
                                  'Se agotó el plazo del runner.' if timeout else 'Se superó el límite de memoria o archivos.',
                                  'timed_out' if timeout else 'failed')
                        continue
                    work = self.root / run_id
                    result_file = work / 'result.json'
                    if process.returncode != 0 or not result_file.is_file():
                        self.fail(r, 'E_WORKER', 'El proceso terminó sin resultados; compruebe los límites.')
                        continue
                    result = json.loads(result_file.read_text())
                    r.update({k: v for k, v in result.items() if k != 'private'})
                    r.update(finished_at=time.time(), expires_at=time.time() + self.settings.ttl_seconds)
                    # SQLite solo recibe el contrato público validado y el manifiesto privado.
                    r = Run.model_validate(r).model_dump()
                    if r['state'] == 'failed':
                        shutil.rmtree(work, ignore_errors=True)
                    else:
                        (work / 'request.json').unlink(missing_ok=True)
                        result_file.unlink(missing_ok=True)
                        shutil.rmtree(work / 'inputs', ignore_errors=True)
                    self.repository.put(r, result.get('private', {}))
            available = self.settings.active - len(self.processes)
            queued = [r for r, _ in self.repository.all() if r['state'] == 'queued']
            for r in sorted(queued, key=lambda r: r['created_at'])[:available]:
                work = self.root / r['id']
                env = {**os.environ, 'PYTHONPATH': str(ROOT), 'POLARS_MAX_THREADS': '2', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'}
                try:
                    process = subprocess.Popen([sys.executable, '-m', 'service.runner.worker', str(work), str(os.getpid())],
                        cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        start_new_session=True)
                    self.processes[r['id']] = (process, time.monotonic(), 0)
                    r.update(state='running', started_at=time.time())
                    try:
                        birth = psutil.Process(process.pid).create_time()
                    except psutil.Error:
                        birth = None
                    self.repository.put(r, dict(pid=process.pid, birth=birth))
                except OSError:
                    self.fail(r, 'E_UNAVAILABLE', 'No se pudo iniciar el proceso ejecutor.')

    def loop(self):
        while not self.stopping.wait(.05):
            try:
                self.tick()
            except Exception as exc:
                logging.getLogger(__name__).error("Gestor detenido (%s); reinicie el servicio.", type(exc).__name__)
                # Un fallo del gestor debe deshabilitar admisiones, sin registrar fuente o filas.
                self.stopping.set()

    @property
    def available(self):
        return not self.stopping.is_set() and self.thread.is_alive()

    def close(self):
        if self.lockfile.closed:
            return
        self.stopping.set()
        self.thread.join(timeout=5)
        with self.lock:
            for r, _ in self.repository.all():
                if r['state'] in ACTIVE:
                    self.cancel(r['id'])
        fcntl.flock(self.lockfile, fcntl.LOCK_UN)
        self.lockfile.close()
