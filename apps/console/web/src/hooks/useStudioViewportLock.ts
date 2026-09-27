import { useEffect } from 'react';

/** Lock document scrolling while the fixed-height studio is mounted. */
export function useStudioViewportLock() {
  useEffect(() => {
    const body = document.body.style;
    const html = document.documentElement.style;
    const previous = { body: body.overflow, html: html.overflow };
    body.overflow = 'hidden';
    html.overflow = 'hidden';
    return () => {
      body.overflow = previous.body;
      html.overflow = previous.html;
    };
  }, []);
}
