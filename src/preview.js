import { cloneEq } from './eq.js';

/** One active RAM transaction and at most one pending, latest editor snapshot. */
export class PreviewQueue {
  constructor({ send, onResult = () => {}, onError = () => {}, onChange = () => {}, delay = 140, maxWait = 320 } = {}) {
    this.send = send; this.onResult = onResult; this.onError = onError; this.onChange = onChange;
    this.delay = delay; this.maxWait = maxWait; this.pending = null; this.running = null; this.timer = null;
    this.epoch = 0; this.revision = 0;
  }
  get busy() { return !!this.running || !!this.pending; }
  enqueue(eq) {
    const queuedAt = this.pending?.queuedAt ?? Date.now();
    this.pending = { eq: cloneEq(eq), epoch: this.epoch, revision: ++this.revision, queuedAt };
    clearTimeout(this.timer);
    // Bound the debounce so a continuous slider drag also updates the device.
    const wait = Math.max(0, Math.min(this.delay, this.maxWait - (Date.now() - queuedAt)));
    this.timer = setTimeout(() => { this.timer = null; this.start(); }, wait);
    this.onChange();
  }
  start() {
    if (this.running || !this.pending) return;
    const job = this.pending; this.pending = null;
    this.running = (async () => {
      try {
        const result = await Promise.resolve().then(() => this.send(job.eq, () => job.epoch === this.epoch && job.revision === this.revision));
        if (job.epoch === this.epoch) this.onResult(result);
      } catch (error) {
        if (job.epoch === this.epoch) {
          this.pending = null; clearTimeout(this.timer); this.timer = null;
          this.onError(error);
        }
      } finally {
        this.running = null;
        if (this.pending && this.timer === null) this.start();
        this.onChange();
      }
    })();
    this.onChange();
  }
  cancel() {
    ++this.epoch; this.pending = null; clearTimeout(this.timer); this.timer = null;
    this.onChange();
  }
  async idle() { while (this.running) await this.running; }
}
