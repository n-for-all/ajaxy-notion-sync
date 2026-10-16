// app/utils/cors.server.ts
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // Or your specific domain
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function handleCors(request: Request) {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    return null;
}