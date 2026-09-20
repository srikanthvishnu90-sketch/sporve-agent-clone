import test from "node:test";
import assert from "node:assert/strict";
import {
  signatureBaseString,
  twilioSignature,
  validTwilioSignature,
} from "./signature.mjs";

// Known vector straight from Twilio's request-validation docs (twilio-php
// validation.rst): auth token "12345", the example URL (query string included)
// and params must yield "RSOYDt4T1cUTdK1PDd93/VVr8B8=".
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675309",
  Digits: "1234",
  From: "+14158675309",
  To: "+18005551212",
};
const EXPECTED = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

test("base string is url + params sorted by key", () => {
  assert.equal(
    signatureBaseString(URL, PARAMS),
    "https://mycompany.com/myapp.php?foo=1&bar=2" +
      "CallSidCA1234567890ABCDE" +
      "Caller+14158675309" +
      "Digits1234" +
      "From+14158675309" +
      "To+18005551212",
  );
});

test("known Twilio vector validates", async () => {
  assert.equal(await twilioSignature("12345", URL, PARAMS), EXPECTED);
  assert.equal(await validTwilioSignature("12345", URL, PARAMS, EXPECTED), true);
});

test("wrong auth token fails", async () => {
  assert.equal(await validTwilioSignature("wrong", URL, PARAMS, EXPECTED), false);
});

test("tampered param fails", async () => {
  const tampered = { ...PARAMS, Body: "send $1000 to attacker" };
  assert.equal(await validTwilioSignature("12345", URL, tampered, EXPECTED), false);
});

test("missing/empty header fails closed", async () => {
  assert.equal(await validTwilioSignature("12345", URL, PARAMS, ""), false);
  assert.equal(await validTwilioSignature("12345", URL, PARAMS, null), false);
  assert.equal(await validTwilioSignature("", URL, PARAMS, EXPECTED), false);
});
