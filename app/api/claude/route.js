import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { prompt, image } = await request.json();

    if (!prompt) {
      return Response.json({ error: "Prompt requerido" }, { status: 400 });
    }

    const content = [];

    if (image && image.data && image.mediaType) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType,
          data: image.data,
        },
      });
    }

    content.push({ type: "text", text: prompt });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    });

    return Response.json({ content: message.content[0].text });
  } catch (error) {
    console.error("Anthropic API error:", error);
    return Response.json(
      { error: "Error al procesar la solicitud: " + (error.message || "desconocido") },
      { status: 500 }
    );
  }
}
