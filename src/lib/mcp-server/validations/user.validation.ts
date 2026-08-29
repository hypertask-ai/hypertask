import { z } from 'zod';

export function getUpdateProfileBaseSchema() {
  return z
    .object({
      // Empty string is allowed on both fields: the route reads it as "leave
      // this one alone", so rejecting it here would make the tool stricter
      // than the endpoint it wraps.
      displayName: z
        .string()
        .trim()
        .max(100)
        .refine((value) => !/[<>]/.test(value), {
          message: 'displayName must not contain < or > characters',
        })
        .optional(),
      photoURL: z
        .string()
        .trim()
        // One refine that never throws. new URL('') raises rather than
        // returning a validation failure, and a union alternative does not
        // shield a refine that throws.
        .refine((value) => {
          if (value === '') return true;
          try {
            const { protocol } = new URL(value);
            return protocol === 'http:' || protocol === 'https:';
          } catch {
            return false;
          }
        }, 'photoURL must be a valid http(s) URL')
        .optional(),
    })
    .strict();
}

export function getUpdateProfileInputSchema() {
  return getUpdateProfileBaseSchema().refine(
      (data) => data.displayName !== undefined || data.photoURL !== undefined,
      {
        message: 'At least one of displayName or photoURL must be provided',
        path: ['displayName', 'photoURL'],
      }
    );
}

export const UpdateProfileInputSchema = getUpdateProfileInputSchema();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
