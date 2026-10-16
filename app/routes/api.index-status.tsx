import { json, type ActionFunction, type LoaderFunction } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { handleCors } from "~/utils/cors.server";

export const loader: LoaderFunction = async ({ request }) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  try {
    const { session } = await authenticate.admin(request);

    if (!session || !session.shop) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = await prisma.indexStatus.findUnique({
      where: { shop: session.shop },
      select: {
        status: true,
        lastIndexedAt: true,
        productsCount: true,
        blogsCount: true,
        collectionsCount: true,
        errorMessage: true,
      },
    });

    if (!status) {
      return json({
        status: "idle",
        lastIndexedAt: null,
        productsCount: 0,
        blogsCount: 0,
        collectionsCount: 0,
      });
    }

    return json(status);
  } catch (error) {
    console.error("Index status error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

export const action: ActionFunction = async ({ request }) => {
  if (request.method === "GET") {
    return loader({ request } as any);
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};
