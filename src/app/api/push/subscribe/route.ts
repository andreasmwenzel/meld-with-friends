import { z } from "zod";
import { body, json, requireUser } from "@/server/http";
import { endpointSchema, subscriptionSchema, subscribe, unsubscribe } from "@/server/push-subscriptions";

export async function POST(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const { subscription } = await body(request, z.object({ subscription: subscriptionSchema }).strict());
    return subscribe(user.id, subscription);
  });
}
export async function DELETE(request: Request) {
  return json(async () => {
    const { user } = await requireUser();
    const { endpoint } = await body(request, z.object({ endpoint: endpointSchema }).strict());
    return unsubscribe(user.id, endpoint);
  });
}
