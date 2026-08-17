import type {
  SqliteVideoRepository,
  VideoProjectEvent,
} from "../repository/sqlite-video-repository.js";

interface Subscriber {
  projectId: string;
  cursor: number;
  send: (event: VideoProjectEvent) => void;
}

export class ProjectEventDispatcher {
  private readonly subscribers = new Set<Subscriber>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private closed = false;

  constructor(
    private readonly repository: SqliteVideoRepository,
    private readonly activePollMs: number,
    private readonly idlePollMs: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  subscribe(
    projectId: string,
    afterId: number,
    send: (event: VideoProjectEvent) => void,
  ): () => void {
    if (this.closed) throw new Error("Project event dispatcher is closed");
    const subscriber: Subscriber = { projectId, cursor: afterId, send };
    this.subscribers.add(subscriber);
    this.deliver(subscriber);
    this.schedule(0);
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.schedule(this.idlePollMs);
    };
  }

  notify(): void {
    if (!this.closed) this.schedule(0);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.subscribers.clear();
  }

  private schedule(delay: number): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll();
    }, delay);
  }

  private poll(): void {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      for (const subscriber of this.subscribers) {
        try {
          this.deliver(subscriber);
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.polling = false;
      this.schedule(this.subscribers.size > 0 ? this.activePollMs : this.idlePollMs);
    }
  }

  private deliver(subscriber: Subscriber): void {
    const events = this.repository.listEvents(subscriber.projectId, subscriber.cursor);
    for (const event of events) {
      subscriber.send(event);
      subscriber.cursor = event.id;
    }
  }
}
