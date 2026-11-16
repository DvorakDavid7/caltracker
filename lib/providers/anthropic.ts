import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NutritionSchema, SYSTEM_PROMPT } from "../nutrition";

let client: Anthropic | undefined;

export async function estimate(description: string): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Chybí ANTHROPIC_API_KEY v souboru .env");
  client ??= new Anthropic();

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

    if (response.stop_reason === "refusal") {
      throw new Error("AI odmítla tento vstup vyhodnotit");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Odpověď AI byla useknutá");
    }
    if (!response.parsed_output) throw new Error("AI nevrátila platná data");
    return response.parsed_output;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Neplatný ANTHROPIC_API_KEY");
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error("Klíč nemá přístup k modelu");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Příliš mnoho požadavků, zkus to za chvíli");
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API chyba ${err.status}: ${err.message}`);
    throw err;
  }
}
