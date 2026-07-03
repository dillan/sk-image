// Self-contained fake image worker used to unit-test WorkerPoolImageProcessor's dispatch /
// coalescing / crash-recovery / timeout logic WITHOUT sharp or the real worker. It never decodes
// anything — trigger widths drive the failure modes the pool must survive:
//   width 666 -> process.exit(7)  (hard crash: fires 'exit', not 'error')
//   width 777 -> never reply      (hang: pool must time the job out and respawn)
//   otherwise -> reply ok with a dummy buffer
const { parentPort } = require('node:worker_threads');

parentPort.on('message', (msg) => {
  const { id, width } = msg;
  if (width === 666) {
    process.exit(7);
  }
  if (width === 777) {
    return;
  }
  const buffer = new ArrayBuffer(8);
  parentPort.postMessage({ id, ok: true, buffer, width, height: width }, [buffer]);
});
