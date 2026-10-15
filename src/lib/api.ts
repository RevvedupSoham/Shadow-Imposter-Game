import { supabase } from "./supabase";

export type GameAction =
 | { action:"create_room"; name:string; token:string }
 | { action:"join_room"; code:string; name:string; token:string }
 | { action:"start_game"; code:string; token:string }
 | { action:"submit_clue"; code:string; token:string; clue:string }
 | { action:"send_chat"; code:string; token:string; message:string }
 | { action:"begin_voting"; code:string; token:string }
 | { action:"vote"; code:string; token:string; target_player_id:string }
 | { action:"guess_secret"; code:string; token:string; guess:string }
 | { action:"get_state"; code:string; token:string }
 | { action:"leave_room"; code:string; token:string };
export type GameSnapshot = {
 ok:boolean;
 room:{code:string;phase:"lobby"|"clue"|"discussion"|"voting"|"guess"|"results";round:number;winner:"crew"|"impostor"|null;tie_count:number;player_count:number;secret_word:string|null;decoy_word:string|null;phase_started_at:string};
 you:{player_id:string;name:string;is_host:boolean;alive:boolean;role:"crew"|"impostor"|null;word:string|null};
 players:Array<{player_id:string;name:string;alive:boolean;has_clued:boolean;clue:string|null;is_host:boolean;role:"crew"|"impostor"|null}>;
 chat:Array<{name:string;message:string;created_at:string}>;
 player_token?:string;
 stats?:{games_played:number;crew_wins:number;impostor_wins:number};
};
export async function sendAction(action:GameAction):Promise<GameSnapshot|{ok:true}>{
 if(!supabase) throw new Error("Backend is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your deployment environment.");
 const {data,error}=await supabase.functions.invoke("game",{body:action});
 if(error) throw new Error(error.message);
 if(data?.error) throw new Error(data.error);
 return data as GameSnapshot|{ok:true};
}
export function subscribeToRoom(code:string,onChange:()=>void):()=>void{
 if(!supabase)return()=>undefined;
 const channel=supabase.channel(`room:${code}`).on("broadcast",{event:"changed"},onChange).subscribe();
 return()=>{void supabase?.removeChannel(channel)};
}
