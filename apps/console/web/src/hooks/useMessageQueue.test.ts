import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMessageQueue } from './useMessageQueue';

describe('useMessageQueue', () => {
  it('starts with an empty queue', () => {
    const { result } = renderHook(() => useMessageQueue());
    expect(result.current.queue).toEqual([]);
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.size).toBe(0);
  });

  it('adds messages to the queue', () => {
    const { result } = renderHook(() => useMessageQueue());

    act(() => {
      result.current.add('message 1');
      result.current.add('message 2');
    });

    expect(result.current.size).toBe(2);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.queue[0]?.content).toBe('message 1');
    expect(result.current.queue[1]?.content).toBe('message 2');
  });

  it('edits queued messages', () => {
    const { result } = renderHook(() => useMessageQueue());
    let msgId: string;

    act(() => {
      msgId = result.current.add('original');
    });

    act(() => {
      result.current.update(msgId!, 'updated');
    });

    expect(result.current.queue[0]?.content).toBe('updated');
  });

  it('removes messages from the queue', () => {
    const { result } = renderHook(() => useMessageQueue());
    let msgId: string;

    act(() => {
      msgId = result.current.add('message 1');
      result.current.add('message 2');
    });

    expect(result.current.size).toBe(2);

    act(() => {
      result.current.remove(msgId!);
    });

    expect(result.current.size).toBe(1);
    expect(result.current.queue[0]?.content).toBe('message 2');
  });

  it('gets the first message without removing it', () => {
    const { result } = renderHook(() => useMessageQueue());

    act(() => {
      result.current.add('message 1');
      result.current.add('message 2');
    });

    const first = result.current.getFirst();
    expect(first?.content).toBe('message 1');
    expect(result.current.size).toBe(2); // Should still be there
  });

  it('removes the first message', () => {
    const { result } = renderHook(() => useMessageQueue());

    act(() => {
      result.current.add('message 1');
      result.current.add('message 2');
    });

    act(() => {
      result.current.removeFirst();
    });

    expect(result.current.size).toBe(1);
    expect(result.current.queue[0]?.content).toBe('message 2');
  });

  it('clears the queue', () => {
    const { result } = renderHook(() => useMessageQueue());

    act(() => {
      result.current.add('message 1');
      result.current.add('message 2');
      result.current.add('message 3');
    });

    expect(result.current.size).toBe(3);

    act(() => {
      result.current.clear();
    });

    expect(result.current.queue).toEqual([]);
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.size).toBe(0);
  });

  it('returns null when getting first from empty queue', () => {
    const { result } = renderHook(() => useMessageQueue());
    expect(result.current.getFirst()).toBeNull();
  });

  it('assigns unique IDs to messages', () => {
    const { result } = renderHook(() => useMessageQueue());
    let id1: string, id2: string;

    act(() => {
      id1 = result.current.add('message 1');
      id2 = result.current.add('message 2');
    });

    expect(id1).not.toBe(id2);
    expect(result.current.queue[0]?.id).toBe(id1);
    expect(result.current.queue[1]?.id).toBe(id2);
  });
});
