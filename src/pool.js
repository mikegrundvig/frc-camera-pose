// A pool of module workers and the two ways the searches use it: send each worker a message and wait
// for every reply, and run a queue of jobs on the workers as they come free.

// Starts `count` workers from a module `url`. Gives { workers, everyWorker, runQueue, stop, finish,
// onStop }.
export function createPool(url, count) {
  const workers = [];
  let stopped = false;
  let reject = null;
  for (let i = 0; i < count; i++) workers.push(new Worker(url, { type: 'module' }));

  // Sends each worker a message and waits for the reply of the type asked for from every one.
  const everyWorker = (build, type) =>
    Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve) => {
            const listen = (event) => {
              if (event.data.type === type) {
                worker.removeEventListener('message', listen);
                resolve(event.data);
              }
            };
            worker.addEventListener('message', listen);
            worker.postMessage(build(worker));
          }),
      ),
    );

  // Runs a queue of jobs on the workers as they come free. `make(worker, item)` posts one and gives
  // the type of reply that means it is done; `take(reply, item)` handles that reply, and may add to
  // the queue. Resolves when the queue is empty and every job has come back.
  const runQueue = (queue, make, take) =>
    new Promise((resolve, fail) => {
      const idle = workers.slice();
      let running = 0;
      const pump = () => {
        if (stopped) return;
        while (idle.length > 0 && queue.length > 0) {
          const worker = idle.pop();
          const item = queue.shift();
          running++;
          const type = make(worker, item);
          const listen = (event) => {
            const data = event.data;
            if (data.type === 'error') {
              worker.removeEventListener('message', listen);
              fail(new Error(data.message));
            } else if (data.type === type) {
              worker.removeEventListener('message', listen);
              running--;
              idle.push(worker);
              take(data, item);
              pump();
            }
          };
          worker.addEventListener('message', listen);
        }
        if (queue.length === 0 && running === 0) resolve();
      };
      pump();
    });

  return {
    workers,
    everyWorker,
    runQueue,
    // `fail` is called when the pool is stopped, so a promise waiting on it rejects.
    onStop: (fail) => {
      reject = fail;
    },
    stop: () => {
      stopped = true;
      for (const worker of workers) worker.terminate();
      if (reject) reject(new Error('stopped'));
    },
    finish: () => {
      for (const worker of workers) worker.terminate();
    },
  };
}

// How many workers: the cores, less one for the page, at least one, and no more than `most`.
export function workerCount(most = 8) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(cores - 1, most));
}
