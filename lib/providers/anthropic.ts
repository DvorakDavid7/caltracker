import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MenuSchema } from "../menu";
import { NutritionSchema, SYSTEM_PROMPT } from "../nutrition";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Chybí ANTHROPIC_API_KEY v souboru .env");
  client ??= new Anthropic();
  return client;
}

function friendlyError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Neplatný ANTHROPIC_API_KEY");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("Klíč nemá přístup k modelu");
  if (err instanceof Anthropic.RateLimitError) return new Error("Příliš mnoho požadavků, zkus to za chvíli");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API chyba ${err.status}: ${err.message}`);
  return err;
}

function checkStop(stopReason: string | null) {
  if (stopReason === "refusal") throw new Error("AI odmítla tento vstup vyhodnotit");
  if (stopReason === "max_tokens") throw new Error("Odpověď AI byla useknutá");
}

export async function estimate(description: string): Promise<unknown> {
  const client = getClient();
  try {
    const response = await client.beta.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      // High effort: more careful reasoning about portions and reference values.
      output_config: { effort: "high", format: betaZodOutputFormat(NutritionSchema) },
      // If a safety classifier declines, the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: description }],
    });

    checkStop(response.stop_reason);
    if (!response.parsed_output) throw new Error("AI nevrátila platná data");
    return response.parsed_output;
  } catch (err) {
    throw friendlyError(err);
  }
}

/** A whole multi-day plan is long output, so stream it to avoid HTTP timeouts. */
export async function planMenu(system: string, user: string): Promise<unknown> {
  const client = getClient();
  try {
    const stream = client.beta.messages.stream({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 64000,
      // Balancing calories and macros across many meals needs careful reasoning.
      output_config: { effort: "high", format: betaZodOutputFormat(MenuSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
    });
    const response = await stream.finalMessage();
    checkStop(response.stop_reason);
    if (!response.parsed_output) throw new Error("AI nevrátila platná data");
    return response.parsed_output;
  } catch (err) {
    throw friendlyError(err);
  }
}
