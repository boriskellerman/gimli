/**
 * ADW Validation Framework
 *
 * Provides validation capabilities for ADW step outputs including
 * custom validators, JSON schema validation, and common validation patterns.
 */

import type { ADWValidationResult, ADWValidationConfig, ADWLogger } from "./types.js";

/**
 * Validate step output using the provided configuration.
 *
 * @param output - The output to validate
 * @param config - Validation configuration
 * @param logger - Optional logger
 * @returns Validation result
 */
export async function validateStepOutput(
  output: unknown,
  config: ADWValidationConfig,
  logger?: ADWLogger,
): Promise<ADWValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Skip validation if config indicates it's not required and no validators provided
  if (!config.required && !config.validator && !config.schema) {
    return { valid: true };
  }

  // Run custom validator if provided
  if (config.validator) {
    try {
      const timeoutMs = config.timeoutMs ?? 30000;
      const validatorResult = await withTimeout(
        Promise.resolve(config.validator(output)),
        timeoutMs,
      );

      if (!validatorResult.valid) {
        errors.push(...(validatorResult.errors ?? []));
      }
      if (validatorResult.warnings?.length) {
        warnings.push(...validatorResult.warnings);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Validation failed with unknown error";
      errors.push(`Custom validator error: ${errorMessage}`);
      logger?.error("Custom validator threw an error", { error: errorMessage });
    }
  }

  // Run JSON schema validation if provided
  if (config.schema) {
    const schemaResult = validateJsonSchema(output, config.schema);
    if (!schemaResult.valid) {
      errors.push(...(schemaResult.errors ?? []));
    }
    if (schemaResult.warnings?.length) {
      warnings.push(...schemaResult.warnings);
    }
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger?.warn("Validation failed", { errors, warnings });
  } else if (warnings.length > 0) {
    logger?.info("Validation passed with warnings", { warnings });
  }

  return {
    valid,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Execute a promise with a timeout.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Validation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Basic JSON schema validation.
 * This is a lightweight implementation for common validation patterns.
 * For full JSON Schema support, consider using a library like Ajv.
 */
export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "",
): ADWValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const schemaType = schema.type as string | undefined;

  // Null check first (before type validation)
  if (value === null || value === undefined) {
    if (schema.nullable || schema.required === false) {
      return { valid: true };
    }
    if (schema.required !== false && schemaType) {
      errors.push(`${path || "value"}: required but was ${value === null ? "null" : "undefined"}`);
      return { valid: false, errors };
    }
    return { valid: true };
  }

  // Type validation
  if (schemaType) {
    const actualType = getValueType(value);
    if (schemaType === "integer" && actualType !== "integer") {
      errors.push(`${path || "value"}: expected integer, got ${actualType}`);
      return { valid: false, errors };
    }
    // "number" type accepts both integer and number
    if (schemaType === "number" && actualType !== "number" && actualType !== "integer") {
      errors.push(`${path || "value"}: expected ${schemaType}, got ${actualType}`);
      return { valid: false, errors };
    }
    // For other types, strict match
    if (schemaType !== "integer" && schemaType !== "number" && actualType !== schemaType) {
      errors.push(`${path || "value"}: expected ${schemaType}, got ${actualType}`);
      return { valid: false, errors };
    }
  }

  // String validations
  if (schemaType === "string" && typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(
        `${path || "value"}: string length ${value.length} is less than minimum ${schema.minLength}`,
      );
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(
        `${path || "value"}: string length ${value.length} exceeds maximum ${schema.maxLength}`,
      );
    }
    if (schema.pattern && typeof schema.pattern === "string") {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push(`${path || "value"}: does not match pattern ${schema.pattern}`);
      }
    }
    if (schema.enum && Array.isArray(schema.enum)) {
      if (!schema.enum.includes(value)) {
        errors.push(`${path || "value"}: must be one of [${schema.enum.join(", ")}]`);
      }
    }
  }

  // Number validations
  if ((schemaType === "number" || schemaType === "integer") && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path || "value"}: ${value} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path || "value"}: ${value} exceeds maximum ${schema.maximum}`);
    }
  }

  // Array validations
  if (schemaType === "array" && Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(
        `${path || "value"}: array length ${value.length} is less than minimum ${schema.minItems}`,
      );
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(
        `${path || "value"}: array length ${value.length} exceeds maximum ${schema.maxItems}`,
      );
    }
    if (schema.items && typeof schema.items === "object") {
      for (let i = 0; i < value.length; i++) {
        const itemResult = validateJsonSchema(
          value[i],
          schema.items as Record<string, unknown>,
          `${path}[${i}]`,
        );
        if (!itemResult.valid) {
          errors.push(...(itemResult.errors ?? []));
        }
        if (itemResult.warnings?.length) {
          warnings.push(...itemResult.warnings);
        }
      }
    }
  }

  // Object validations
  if (
    schemaType === "object" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const objValue = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = schema.required as string[] | undefined;

    // Check required properties
    if (required) {
      for (const prop of required) {
        if (!(prop in objValue)) {
          errors.push(`${path ? `${path}.${prop}` : prop}: required property is missing`);
        }
      }
    }

    // Validate properties
    if (properties) {
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (propName in objValue) {
          const propPath = path ? `${path}.${propName}` : propName;
          const propResult = validateJsonSchema(objValue[propName], propSchema, propPath);
          if (!propResult.valid) {
            errors.push(...(propResult.errors ?? []));
          }
          if (propResult.warnings?.length) {
            warnings.push(...propResult.warnings);
          }
        }
      }
    }

    // Check for additional properties if not allowed
    if (schema.additionalProperties === false && properties) {
      const allowedProps = new Set(Object.keys(properties));
      for (const key of Object.keys(objValue)) {
        if (!allowedProps.has(key)) {
          warnings.push(`${path ? `${path}.${key}` : key}: unexpected property`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Get the type of a value for schema validation.
 */
function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

// ============================================================================
// Common Validators
// ============================================================================

/**
 * Create a validator that checks if output is not empty.
 */
export function notEmptyValidator(): (output: unknown) => ADWValidationResult {
  return (output: unknown): ADWValidationResult => {
    if (output === null || output === undefined) {
      return { valid: false, errors: ["Output is null or undefined"] };
    }
    if (typeof output === "string" && output.trim() === "") {
      return { valid: false, errors: ["Output is an empty string"] };
    }
    if (Array.isArray(output) && output.length === 0) {
      return { valid: false, errors: ["Output is an empty array"] };
    }
    if (typeof output === "object" && Object.keys(output).length === 0) {
      return { valid: false, errors: ["Output is an empty object"] };
    }
    return { valid: true };
  };
}

/**
 * Create a validator that checks if output has required fields.
 */
export function hasFieldsValidator(fields: string[]): (output: unknown) => ADWValidationResult {
  return (output: unknown): ADWValidationResult => {
    if (!output || typeof output !== "object") {
      return { valid: false, errors: ["Output is not an object"] };
    }
    const errors: string[] = [];
    for (const field of fields) {
      if (!(field in (output as Record<string, unknown>))) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };
}

/**
 * Create a validator that checks string output matches a pattern.
 */
export function patternValidator(
  pattern: RegExp,
  message?: string,
): (output: unknown) => ADWValidationResult {
  return (output: unknown): ADWValidationResult => {
    if (typeof output !== "string") {
      return { valid: false, errors: ["Output is not a string"] };
    }
    if (!pattern.test(output)) {
      return {
        valid: false,
        errors: [message ?? `Output does not match pattern: ${pattern.source}`],
      };
    }
    return { valid: true };
  };
}

/**
 * Create a validator that combines multiple validators (all must pass).
 */
export function allOfValidator(
  validators: Array<(output: unknown) => ADWValidationResult | Promise<ADWValidationResult>>,
): (output: unknown) => Promise<ADWValidationResult> {
  return async (output: unknown): Promise<ADWValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const validator of validators) {
      const result = await validator(output);
      if (!result.valid) {
        errors.push(...(result.errors ?? []));
      }
      if (result.warnings?.length) {
        warnings.push(...result.warnings);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  };
}

/**
 * Create a validator that passes if any validator passes.
 */
export function anyOfValidator(
  validators: Array<(output: unknown) => ADWValidationResult | Promise<ADWValidationResult>>,
): (output: unknown) => Promise<ADWValidationResult> {
  return async (output: unknown): Promise<ADWValidationResult> => {
    const allErrors: string[] = [];

    for (const validator of validators) {
      const result = await validator(output);
      if (result.valid) {
        return { valid: true };
      }
      allErrors.push(...(result.errors ?? []));
    }

    return {
      valid: false,
      errors: [`None of the validators passed. Errors: ${allErrors.join("; ")}`],
    };
  };
}

/**
 * Create a validation config from a simple validator function.
 */
export function createValidationConfig(
  validator: (output: unknown) => ADWValidationResult | Promise<ADWValidationResult>,
  options?: { required?: boolean; timeoutMs?: number },
): ADWValidationConfig {
  return {
    required: options?.required ?? true,
    validator,
    timeoutMs: options?.timeoutMs,
  };
}

/**
 * Create a validation config from a JSON schema.
 */
export function createSchemaValidationConfig(
  schema: Record<string, unknown>,
  options?: { required?: boolean; timeoutMs?: number },
): ADWValidationConfig {
  return {
    required: options?.required ?? true,
    schema,
    timeoutMs: options?.timeoutMs,
  };
}
