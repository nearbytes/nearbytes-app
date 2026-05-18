import { red, yellow } from './output/colors.js';
import { ValidationError } from 'nearbytes-crypto';
import { StorageError } from 'nearbytes-crypto';

/**
 * Handles errors in CLI commands
 * Ensures all errors are reported clearly and never silent
 * 
 * @param error - Error to handle
 * @param context - Optional context about what operation failed
 */
export function handleCliError(error: unknown, context?: string): never {
  // Always exit with non-zero code (fail loudly)
  const exitCode = 1;

  // Build error message
  let message = '';
  let showStack = false;

  if (error instanceof ValidationError) {
    // Validation errors are user-facing, no stack needed
    message = red(`✗ Validation Error: ${error.message}`);
    if (context) {
      message += `\n${yellow(`Context: ${context}`)}`;
    }
  } else if (error instanceof StorageError) {
    // Storage errors are user-facing, but might need stack for debugging
    message = red(`✗ Storage Error: ${error.message}`);
    if (context) {
      message += `\n${yellow(`Context: ${context}`)}`;
    }
    // Show stack in development mode (if NODE_ENV is not production)
    showStack = process.env.NODE_ENV !== 'production';
  } else if (error instanceof Error) {
    // Generic errors: show message and stack
    message = red(`✗ Error: ${error.message}`);
    if (context) {
      message += `\n${yellow(`Context: ${context}`)}`;
    }
    showStack = true;
  } else {
    // Unknown error type
    message = red(`✗ Unknown Error: ${String(error)}`);
    if (context) {
      message += `\n${yellow(`Context: ${context}`)}`;
    }
    showStack = true;
  }

  // Output error
  console.error(message);

  // Show stack trace if needed
  if (showStack && error instanceof Error && error.stack) {
    console.error(red(`\nStack Trace:\n${error.stack}`));
  }

  // Always exit with error code (never silent failure)
  process.exit(exitCode);
}

/**
 * Wraps an async function with error handling
 * Ensures all errors are caught and reported
 * 
 * @param fn - Async function to wrap
 * @param context - Optional context for error messages
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleCliError(error, context);
    }
  }) as T;
}
