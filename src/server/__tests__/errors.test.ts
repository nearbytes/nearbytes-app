import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errors.js';

describe('errorHandler', () => {
  it('surfaces ordinary Error messages instead of replacing them with a generic server error', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('MEGA native sync state is unavailable. Reconnect the account to continue.');
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom').expect(500);

    expect(response.body.error?.message).toBe('MEGA native sync state is unavailable. Reconnect the account to continue.');
  });
});
