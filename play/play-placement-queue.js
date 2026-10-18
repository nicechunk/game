// Preview placement stays synchronous; inventory-consuming transactions run FIFO.
export function createPlacementSubmissionQueue({ submit, onError = () => {} }) {
  const queue = [];
  let running = false;

  function enqueue(pending, controls) {
    const completion = new Promise((resolve) => queue.push({ pending, controls, resolve }));
    void drain();
    return completion;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const { pending, controls, resolve } = queue.shift();
        try {
          await submit(pending, controls);
        } catch (error) {
          try { await onError(pending, controls, error); } catch { /* Continue draining other placements. */ }
        } finally {
          resolve();
        }
      }
    } finally {
      running = false;
    }
  }

  return { enqueue, pendingCount: () => queue.length + Number(running) };
}
