import { describe, it, expect, vi } from "vitest";
import {
  validateStepOutput,
  validateJsonSchema,
  notEmptyValidator,
  hasFieldsValidator,
  patternValidator,
  allOfValidator,
  anyOfValidator,
  createValidationConfig,
  createSchemaValidationConfig,
} from "./validation.js";

describe("validateStepOutput", () => {
  it("passes when validation is not required and no validators", async () => {
    const result = await validateStepOutput("any value", { required: false });
    expect(result.valid).toBe(true);
  });

  it("runs custom validator", async () => {
    const validator = vi.fn().mockReturnValue({ valid: true });
    const config = { required: true, validator };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(true);
    expect(validator).toHaveBeenCalledWith("test");
  });

  it("collects errors from custom validator", async () => {
    const validator = vi.fn().mockReturnValue({ valid: false, errors: ["Error 1", "Error 2"] });
    const config = { required: true, validator };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Error 1", "Error 2"]);
  });

  it("handles async validators", async () => {
    const validator = vi.fn().mockResolvedValue({ valid: true });
    const config = { required: true, validator };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(true);
  });

  it("handles validator timeout", async () => {
    const validator = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ valid: true }), 100);
        }),
    );
    const config = { required: true, validator, timeoutMs: 10 };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain("timed out");
  });

  it("handles validator errors", async () => {
    const validator = vi.fn().mockRejectedValue(new Error("Validator crashed"));
    const config = { required: true, validator };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain("Custom validator error");
  });

  it("runs JSON schema validation", async () => {
    const config = {
      required: true,
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      },
    };

    const validResult = await validateStepOutput({ name: "test", age: 25 }, config);
    expect(validResult.valid).toBe(true);

    const invalidResult = await validateStepOutput({ age: 25 }, config);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors?.[0]).toContain("name");
  });

  it("collects warnings", async () => {
    const validator = vi.fn().mockReturnValue({ valid: true, warnings: ["Consider using X"] });
    const config = { required: true, validator };

    const result = await validateStepOutput("test", config);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(["Consider using X"]);
  });
});

describe("validateJsonSchema", () => {
  describe("type validation", () => {
    it("validates string type", () => {
      const schema = { type: "string" };

      expect(validateJsonSchema("hello", schema).valid).toBe(true);
      expect(validateJsonSchema(123, schema).valid).toBe(false);
    });

    it("validates number type", () => {
      const schema = { type: "number" };

      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema(123.45, schema).valid).toBe(true);
      expect(validateJsonSchema("123", schema).valid).toBe(false);
    });

    it("validates integer type", () => {
      const schema = { type: "integer" };

      expect(validateJsonSchema(123, schema).valid).toBe(true);
      expect(validateJsonSchema(123.45, schema).valid).toBe(false);
    });

    it("validates boolean type", () => {
      const schema = { type: "boolean" };

      expect(validateJsonSchema(true, schema).valid).toBe(true);
      expect(validateJsonSchema(false, schema).valid).toBe(true);
      expect(validateJsonSchema("true", schema).valid).toBe(false);
    });

    it("validates array type", () => {
      const schema = { type: "array" };

      expect(validateJsonSchema([], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema({}, schema).valid).toBe(false);
    });

    it("validates object type", () => {
      const schema = { type: "object" };

      expect(validateJsonSchema({}, schema).valid).toBe(true);
      expect(validateJsonSchema({ a: 1 }, schema).valid).toBe(true);
      expect(validateJsonSchema([], schema).valid).toBe(false);
    });
  });

  describe("string validations", () => {
    it("validates minLength", () => {
      const schema = { type: "string", minLength: 3 };

      expect(validateJsonSchema("abc", schema).valid).toBe(true);
      expect(validateJsonSchema("ab", schema).valid).toBe(false);
    });

    it("validates maxLength", () => {
      const schema = { type: "string", maxLength: 5 };

      expect(validateJsonSchema("hello", schema).valid).toBe(true);
      expect(validateJsonSchema("hello!", schema).valid).toBe(false);
    });

    it("validates pattern", () => {
      const schema = { type: "string", pattern: "^[a-z]+$" };

      expect(validateJsonSchema("hello", schema).valid).toBe(true);
      expect(validateJsonSchema("Hello", schema).valid).toBe(false);
    });

    it("validates enum", () => {
      const schema = { type: "string", enum: ["a", "b", "c"] };

      expect(validateJsonSchema("a", schema).valid).toBe(true);
      expect(validateJsonSchema("d", schema).valid).toBe(false);
    });
  });

  describe("number validations", () => {
    it("validates minimum", () => {
      const schema = { type: "number", minimum: 0 };

      expect(validateJsonSchema(0, schema).valid).toBe(true);
      expect(validateJsonSchema(10, schema).valid).toBe(true);
      expect(validateJsonSchema(-1, schema).valid).toBe(false);
    });

    it("validates maximum", () => {
      const schema = { type: "number", maximum: 100 };

      expect(validateJsonSchema(100, schema).valid).toBe(true);
      expect(validateJsonSchema(50, schema).valid).toBe(true);
      expect(validateJsonSchema(101, schema).valid).toBe(false);
    });
  });

  describe("array validations", () => {
    it("validates minItems", () => {
      const schema = { type: "array", minItems: 2 };

      expect(validateJsonSchema([1, 2], schema).valid).toBe(true);
      expect(validateJsonSchema([1], schema).valid).toBe(false);
    });

    it("validates maxItems", () => {
      const schema = { type: "array", maxItems: 3 };

      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema([1, 2, 3, 4], schema).valid).toBe(false);
    });

    it("validates item schema", () => {
      const schema = {
        type: "array",
        items: { type: "number" },
      };

      expect(validateJsonSchema([1, 2, 3], schema).valid).toBe(true);
      expect(validateJsonSchema([1, "two", 3], schema).valid).toBe(false);
    });
  });

  describe("object validations", () => {
    it("validates required properties", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      expect(validateJsonSchema({ name: "test" }, schema).valid).toBe(true);
      expect(validateJsonSchema({ age: 25 }, schema).valid).toBe(false);
    });

    it("validates nested object properties", () => {
      const schema = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      };

      expect(validateJsonSchema({ user: { name: "test" } }, schema).valid).toBe(true);
      expect(validateJsonSchema({ user: {} }, schema).valid).toBe(false);
    });

    it("warns on additional properties when not allowed", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      };

      const result = validateJsonSchema({ name: "test", extra: "field" }, schema);
      expect(result.valid).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });
  });

  describe("null handling", () => {
    it("allows null when nullable is true", () => {
      const schema = { type: "string", nullable: true };

      expect(validateJsonSchema(null, schema).valid).toBe(true);
    });

    it("rejects null when nullable is false", () => {
      const schema = { type: "string" };

      expect(validateJsonSchema(null, schema).valid).toBe(false);
    });
  });
});

describe("common validators", () => {
  describe("notEmptyValidator", () => {
    it("rejects null and undefined", () => {
      const validator = notEmptyValidator();

      expect(validator(null).valid).toBe(false);
      expect(validator(undefined).valid).toBe(false);
    });

    it("rejects empty strings", () => {
      const validator = notEmptyValidator();

      expect(validator("").valid).toBe(false);
      expect(validator("   ").valid).toBe(false);
    });

    it("rejects empty arrays", () => {
      const validator = notEmptyValidator();

      expect(validator([]).valid).toBe(false);
    });

    it("rejects empty objects", () => {
      const validator = notEmptyValidator();

      expect(validator({}).valid).toBe(false);
    });

    it("accepts non-empty values", () => {
      const validator = notEmptyValidator();

      expect(validator("hello").valid).toBe(true);
      expect(validator([1]).valid).toBe(true);
      expect(validator({ a: 1 }).valid).toBe(true);
      expect(validator(0).valid).toBe(true);
      expect(validator(false).valid).toBe(true);
    });
  });

  describe("hasFieldsValidator", () => {
    it("validates required fields exist", () => {
      const validator = hasFieldsValidator(["name", "age"]);

      expect(validator({ name: "test", age: 25 }).valid).toBe(true);
      expect(validator({ name: "test" }).valid).toBe(false);
      expect(validator({}).valid).toBe(false);
    });

    it("rejects non-objects", () => {
      const validator = hasFieldsValidator(["name"]);

      expect(validator("not an object").valid).toBe(false);
      expect(validator(null).valid).toBe(false);
      expect(validator([]).valid).toBe(false);
    });
  });

  describe("patternValidator", () => {
    it("validates string matches pattern", () => {
      const validator = patternValidator(/^[A-Z][a-z]+$/);

      expect(validator("Hello").valid).toBe(true);
      expect(validator("hello").valid).toBe(false);
    });

    it("rejects non-strings", () => {
      const validator = patternValidator(/test/);

      expect(validator(123).valid).toBe(false);
      expect(validator({}).valid).toBe(false);
    });

    it("uses custom error message", () => {
      const validator = patternValidator(/^[A-Z]+$/, "Must be uppercase");

      const result = validator("hello");
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toBe("Must be uppercase");
    });
  });

  describe("allOfValidator", () => {
    it("passes when all validators pass", async () => {
      const validator = allOfValidator([notEmptyValidator(), hasFieldsValidator(["name"])]);

      const result = await validator({ name: "test" });
      expect(result.valid).toBe(true);
    });

    it("fails when any validator fails", async () => {
      const validator = allOfValidator([notEmptyValidator(), hasFieldsValidator(["name"])]);

      const result = await validator({});
      expect(result.valid).toBe(false);
    });

    it("collects all errors", async () => {
      const validator = allOfValidator([
        () => ({ valid: false, errors: ["Error 1"] }),
        () => ({ valid: false, errors: ["Error 2"] }),
      ]);

      const result = await validator("test");
      expect(result.errors).toEqual(["Error 1", "Error 2"]);
    });
  });

  describe("anyOfValidator", () => {
    it("passes when any validator passes", async () => {
      const validator = anyOfValidator([
        () => ({ valid: false, errors: ["Fail"] }),
        () => ({ valid: true }),
      ]);

      const result = await validator("test");
      expect(result.valid).toBe(true);
    });

    it("fails when all validators fail", async () => {
      const validator = anyOfValidator([
        () => ({ valid: false, errors: ["Error 1"] }),
        () => ({ valid: false, errors: ["Error 2"] }),
      ]);

      const result = await validator("test");
      expect(result.valid).toBe(false);
    });
  });
});

describe("config creators", () => {
  describe("createValidationConfig", () => {
    it("creates config with validator", () => {
      const validator = () => ({ valid: true });
      const config = createValidationConfig(validator);

      expect(config.required).toBe(true);
      expect(config.validator).toBe(validator);
    });

    it("allows custom options", () => {
      const validator = () => ({ valid: true });
      const config = createValidationConfig(validator, {
        required: false,
        timeoutMs: 5000,
      });

      expect(config.required).toBe(false);
      expect(config.timeoutMs).toBe(5000);
    });
  });

  describe("createSchemaValidationConfig", () => {
    it("creates config with schema", () => {
      const schema = { type: "object" };
      const config = createSchemaValidationConfig(schema);

      expect(config.required).toBe(true);
      expect(config.schema).toBe(schema);
    });
  });
});
