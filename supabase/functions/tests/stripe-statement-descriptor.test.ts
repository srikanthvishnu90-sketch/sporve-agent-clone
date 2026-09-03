import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stripeStatementDescriptorSuffix } from "../_shared/stripe_statement_descriptor.ts";

Deno.test("statement suffix is deterministic and safe for the 22-character combined cap", () => {
  assertEquals(stripeStatementDescriptorSuffix("North Shore Soccer"), "NORTH SHOR");
  assertEquals(stripeStatementDescriptorSuffix("Élite Fútbol"), "ELITE FUTB");
  assertEquals(stripeStatementDescriptorSuffix("<ACME* Club>"), "ACME CLUB");
});

Deno.test("statement suffix always contains a letter", () => {
  assertEquals(stripeStatementDescriptorSuffix("12345"), "CLUB");
  assertEquals(stripeStatementDescriptorSuffix(null), "CLUB");
});
