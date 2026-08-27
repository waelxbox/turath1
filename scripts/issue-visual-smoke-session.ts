import { SignJWT } from "jose";
import { ENV } from "../server/_core/env";
import { getUserByEmail, getUserByOpenId } from "../server/db";

const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
if (!owner) throw new Error("The authorized owner account is not present in the runtime database.");

const secret = new TextEncoder().encode(ENV.cookieSecret || "turath-fallback-secret");
const token = await new SignJWT({
  openId: owner.openId,
  name: owner.name || ENV.ownerName || "TURATH owner",
  appId: ENV.appId || "turath",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(secret);

console.log(token);
