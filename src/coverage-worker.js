// Scores the layout over the whole field off the page's main thread, so the page stays responsive.
// It takes { id, field, scoring } and answers with progress messages and then the result.

import { scoreField } from './coverage.js';

self.onmessage = (event) => {
  const { id, field, scoring } = event.data;
  try {
    const result = scoreField(field, scoring, (share) => self.postMessage({ id, progress: share }));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
