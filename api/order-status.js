import {json,setCors} from "../lib/http.js";
import {retrieveCheckoutSession} from "../lib/stripe.js";
export default async function handler(req,res) {
  setCors(res); res.setHeader("Cache-Control","private, no-store");
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed"});
  const id=String(req.query.session_id||"");
  if(!/^cs_(live|test)_[a-zA-Z0-9]+$/.test(id)) return json(res,400,{error:"Invalid order reference"});
  try {
    const session=await retrieveCheckoutSession(id);
    return json(res,200,{status:session.status,payment_status:session.payment_status});
  } catch {return json(res,404,{error:"Order reference could not be verified"});}
}
