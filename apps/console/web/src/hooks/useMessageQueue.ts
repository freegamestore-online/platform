import { useCallback, useState } from 'react';

export interface QueuedMessage {
  id: string;
  content: string;
}

export function useMessageQueue() {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);

  const add = useCallback((message: string) => {
    const id = Math.random().toString(36).substring(2, 11);
    setQueue((prev) => [...prev, { id, content: message }]);
    return id;
  }, []);

  const update = useCallback((id: string, content: string) => {
    setQueue((prev) => prev.map((msg) => (msg.id === id ? { ...msg, content } : msg)));
  }, []);

  const remove = useCallback((id: string) => {
    setQueue((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  const getFirst = useCallback(() => queue[0] || null, [queue]);

  const removeFirst = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  return {
    queue,
    add,
    update,
    remove,
    clear,
    getFirst,
    removeFirst,
    isEmpty: queue.length === 0,
    size: queue.length,
  };
}
