import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errors.js';

describe('errorHandler', () => {
  it('surfaces ordinary Error messages instead of replacing them with a generic server error', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('MEGA CLI was not found. Install MEGAcmd or set NEARBYTES_MEGACMD_DIR.');
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom').expect(500);

    expect(response.body.error?.message).toBe(
      'MEGA CLI was not found. Install MEGAcmd or set NEARBYTES_MEGACMD_DIR.'
    );
  });
});
