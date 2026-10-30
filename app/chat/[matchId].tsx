// app/chat/[matchId].tsx
// Stable real-time chat: subscribe only after all postgres_changes callbacks are registered.
// Prevents the crash caused by adding postgres_changes callbacks after subscribe().

import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import { API_BASE_URL } from "../../src/lib/config";
import { useAuth } from "../../src/contexts/AuthContext";
import { theme } from "../../src/ui/theme";
import { PremiumHeader } from "../../src/ui/PremiumHeader";
import { useI18n } from "../../src/i18n/I18nProvider";
import { userErrorMessage } from "../../src/lib/userError";
import { formatDateTimeCustom, type Translate } from "../../src/i18n/formatters";

type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function timeShort(iso: string) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateDividerLabel(iso: string, language: "no" | "en", t: Translate) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t("time.today");
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("time.yesterday");
  return formatDateTimeCustom(date, language, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { language, t } = useI18n();

  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = useMemo(() => {
    const mid = params?.matchId;
    return Array.isArray(mid) ? mid[0] : mid;
  }, [params?.matchId]);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);

  const listRef = useRef<FlatList<Msg>>(null as any);

  const fetchMessages = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, created_at")
        .eq("conversation_id", matchId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (error) throw error;
      setMessages((data as any as Msg[]) ?? []);

      // Scroll to the bottom after the initial load.
      setTimeout(() => {
        try {
          listRef.current?.scrollToEnd({ animated: false });
        } catch {}
      }, 50);
    } catch (e: any) {
      Alert.alert(t("chat.errorTitle"), userErrorMessage(e, t, "chat.loadError", "chat.load"));
    } finally {
      setLoading(false);
    }
  }, [matchId, t]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Real-time subscription: register .on(...) before .subscribe().
  useEffect(() => {
    if (!matchId || !user?.id) return;

    const channel = supabase
      .channel(`realtime:chat:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${matchId}`,
        },
        (payload: any) => {
          const msg = payload?.new as Msg | undefined;
          if (!msg?.id) return;

          setMessages((prev) => {
            // Prevent duplicate messages.
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });

          // Scroll to the bottom when a new message arrives.
          setTimeout(() => {
            try {
              listRef.current?.scrollToEnd({ animated: true });
            } catch {}
          }, 30);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, user?.id]);

  // Refresh when the screen receives focus.
  useFocusEffect(
    useCallback(() => {
      fetchMessages();
      return () => {};
    }, [fetchMessages])
  );

  const sendMessage = useCallback(async () => {
    if (!matchId || !user?.id) return;
    const body = text.replace(/\s+/g, " ").trim();
    if (!body) return;

    setSending(true);
    setText("");

    // Optimistic insert.
    const optimistic: Msg = {
      id: `tmp-${Date.now()}`,
      conversation_id: matchId,
      sender_id: user.id,
      body,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);

    try {
      const { error } = await supabase.from("messages").insert({
        conversation_id: matchId,
        sender_id: user.id,
        body,
      });

      if (error) throw error;

      // Refresh to replace the temporary ID with the persisted ID.
      await fetchMessages();
    } catch (e: any) {
      // Roll back the optimistic message.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      Alert.alert(t("chat.errorTitle"), userErrorMessage(e, t, "chat.sendError", "chat.send"));
      setText(body);
    } finally {
      setSending(false);
      setText("");
    }
  }, [matchId, user?.id, text, fetchMessages, t]);


  const [resolution,setResolution]=useState<any>(null);
  const getToken=async()=> (await supabase.auth.getSession()).data.session?.access_token;
  const loadResolution=useCallback(async()=>{try{const authToken=await getToken();if(!authToken||!matchId)return;const r=await fetch(`${API_BASE_URL}/resolutions/context/MATCH/${encodeURIComponent(String(matchId))}`,{headers:{Authorization:`Bearer ${authToken}`}});const j=await r.json().catch(()=>({}));if(r.ok)setResolution(j);}catch{}},[matchId]);
  const proposeResolution=async()=>{try{const authToken=await getToken();const r=await fetch(`${API_BASE_URL}/resolutions/propose`,{method:"POST",headers:{Authorization:`Bearer ${authToken}`,"Content-Type":"application/json"},body:JSON.stringify({contextType:"MATCH",contextId:String(matchId)})});const j=await r.json().catch(()=>({}));if(!r.ok&&j?.error!=="RESOLUTION_ALREADY_PENDING")throw new Error(j?.error);Alert.alert(t("observation.resolution.sentTitle"),t("observation.resolution.sentBody"));await loadResolution();}catch (e: any) {Alert.alert(t("observation.common.error"),userErrorMessage(e,t,"errors.generic","resolution"));}};
  const respondResolution=async(accept:boolean)=>{try{const authToken=await getToken();const pid=resolution?.proposal?.id;if(!pid)return;const r=await fetch(`${API_BASE_URL}/resolutions/${pid}/respond`,{method:"POST",headers:{Authorization:`Bearer ${authToken}`,"Content-Type":"application/json"},body:JSON.stringify({accept})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error);Alert.alert(accept?t("observation.resolution.closedTitle"):t("observation.resolution.rejectedTitle"),accept?t("observation.resolution.closedBody"):t("observation.resolution.rejectedBody"));await loadResolution();}catch (e: any) {Alert.alert(t("observation.common.error"),userErrorMessage(e,t,"errors.generic","resolution"));}};
  useEffect(()=>{void loadResolution()},[loadResolution]);
  if (!matchId) {
    return (
      <View style={styles.center}>
        <Text>{t("chat.unavailable")}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.compactHeader}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{t("chat.title")}</Text>
            <Text style={styles.headerSubtitle}>{t("chat.subtitle")}</Text>
          </View>
        </View>
        <KeyboardAvoidingView style={styles.keyboardArea} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator /><Text style={styles.muted}>{t("chat.loading")}</Text></View>
          ) : (
            <FlatList
              ref={listRef}
              style={styles.messageList}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.messageContent}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => { try { listRef.current?.scrollToEnd({ animated: false }); } catch {} }}
              ListEmptyComponent={<View style={styles.emptyWrap}><Text style={styles.emptyTitle}>{t("chat.emptyTitle")}</Text><Text style={styles.emptyBody}>{t("chat.emptyBody")}</Text></View>}
              renderItem={({ item, index }) => {
                const mine = item.sender_id === user?.id;
                const previous = index > 0 ? messages[index - 1] : null;
                const showDate = !previous || dayKey(previous.created_at) !== dayKey(item.created_at);
                return <>
                  {showDate && <View style={styles.dateDividerRow}><View style={styles.dateDivider}><Text style={styles.dateDividerText}>{dateDividerLabel(item.created_at, language, t)}</Text></View></View>}
                  <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowOther]}><View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleOther]}><Text style={[styles.body, mine ? styles.bodyMe : styles.bodyOther]}>{item.body}</Text><Text style={[styles.time, mine ? styles.timeMe : styles.timeOther]}>{timeShort(item.created_at)}</Text></View></View>
                </>;
              }}
            />
          )}
          <View style={styles.resolutionWrap}>{!resolution?.proposal&&<Pressable style={styles.resolveBtn} onPress={()=>Alert.alert(t("observation.resolution.proposeTitle"),t("chat.resolution.proposeBody"),[{text:t("observation.resolution.cancel"),style:"cancel"},{text:t("observation.resolution.sendProposal"),onPress:proposeResolution}])}><Text style={styles.resolveText}>{t("observation.resolution.proposeButton")}</Text></Pressable>}{resolution?.proposal?.status==="PENDING"&&resolution?.role==="PROPOSER"&&<Text style={styles.pendingText}>{t("observation.resolution.pending")}</Text>}{resolution?.proposal?.status==="PENDING"&&resolution?.role==="RESPONDER"&&<View style={styles.resolutionActions}><Pressable style={styles.acceptBtn} onPress={()=>respondResolution(true)}><Text style={styles.acceptText}>{t("observation.resolution.confirm")}</Text></Pressable><Pressable style={styles.declineBtn} onPress={()=>respondResolution(false)}><Text style={styles.declineText}>{t("observation.resolution.decline")}</Text></Pressable></View>}</View><View style={[styles.composerWrap, { paddingBottom: Math.max(10, insets.bottom) }]}>
            <View style={styles.inputShell}><TextInput value={text} onChangeText={setText} placeholder={t("chat.placeholder")} placeholderTextColor={theme.colors.muted} style={styles.input} multiline maxLength={1000} editable={!sending} /></View>
            <Pressable onPress={() => void sendMessage()} disabled={sending || !text.trim()} style={({ pressed }) => [styles.sendBtn, (sending || !text.trim()) && styles.sendBtnDisabled, pressed && styles.pressed]}><Text style={styles.sendTxt}>{sending ? "…" : t("chat.send")}</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:theme.colors.bg},compactHeader:{flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingTop:4,paddingBottom:10,borderBottomWidth:1,borderBottomColor:"#EEF2F6"},backBtn:{width:42,height:42,borderRadius:21,alignItems:"center",justifyContent:"center",backgroundColor:theme.colors.card,borderWidth:1,borderColor:theme.colors.border},backText:{color:theme.colors.text,fontSize:20,fontWeight:"900"},headerText:{marginLeft:12},headerTitle:{color:theme.colors.text,fontSize:20,fontWeight:"900"},headerSubtitle:{marginTop:1,color:theme.colors.muted,fontSize:12,fontWeight:"700"},keyboardArea:{flex:1},messageList:{flex:1},messageContent:{flexGrow:1,justifyContent:"flex-end",paddingHorizontal:14,paddingTop:12,paddingBottom:10},center:{flex:1,alignItems:"center",justifyContent:"center"},muted:{marginTop:8,color:theme.colors.muted,fontWeight:"700"},emptyWrap:{flex:1,minHeight:220,alignItems:"center",justifyContent:"center",paddingHorizontal:30},emptyTitle:{color:theme.colors.text,fontSize:17,fontWeight:"900"},emptyBody:{marginTop:6,color:theme.colors.muted,fontSize:14,fontWeight:"600",textAlign:"center"},dateDividerRow:{alignItems:"center",marginTop:8,marginBottom:10},dateDivider:{paddingHorizontal:11,paddingVertical:5,borderRadius:999,backgroundColor:"#E9EEF5"},dateDividerText:{color:"#64748B",fontSize:11,fontWeight:"800"},msgRow:{flexDirection:"row",marginBottom:7},msgRowMine:{justifyContent:"flex-end",paddingLeft:54},msgRowOther:{justifyContent:"flex-start",paddingRight:54},bubble:{maxWidth:"86%",minWidth:66,borderRadius:17,paddingHorizontal:12,paddingTop:8,paddingBottom:6},bubbleMe:{backgroundColor:theme.colors.primary,borderBottomRightRadius:5},bubbleOther:{backgroundColor:theme.colors.card,borderWidth:1,borderColor:theme.colors.border,borderBottomLeftRadius:5},body:{fontSize:15.5,fontWeight:"600",lineHeight:20},bodyMe:{color:"#FFF"},bodyOther:{color:theme.colors.text},time:{marginTop:2,fontSize:9.5,fontWeight:"700",alignSelf:"flex-end"},timeMe:{color:"rgba(255,255,255,0.70)"},timeOther:{color:theme.colors.muted},resolutionWrap:{paddingHorizontal:12,paddingTop:8},resolveBtn:{minHeight:42,borderRadius:12,backgroundColor:"#15803D",alignItems:"center",justifyContent:"center"},resolveText:{color:"#fff",fontWeight:"900"},pendingText:{padding:10,textAlign:"center",fontWeight:"800",color:"#92400E",backgroundColor:"#FFFBEB",borderRadius:10},resolutionActions:{flexDirection:"row",gap:8},acceptBtn:{flex:1,minHeight:42,borderRadius:12,backgroundColor:"#15803D",alignItems:"center",justifyContent:"center"},acceptText:{color:"#fff",fontWeight:"900"},declineBtn:{flex:1,minHeight:42,borderRadius:12,borderWidth:1,borderColor:"#DC2626",alignItems:"center",justifyContent:"center"},declineText:{color:"#DC2626",fontWeight:"900"},composerWrap:{flexDirection:"row",alignItems:"flex-end",gap:8,paddingHorizontal:12,paddingTop:9,borderTopWidth:1,borderTopColor:theme.colors.border,backgroundColor:theme.colors.bg},inputShell:{flex:1,minHeight:44,maxHeight:120,borderRadius:17,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.card,justifyContent:"center"},input:{minHeight:42,maxHeight:116,paddingHorizontal:13,paddingTop:10,paddingBottom:9,color:theme.colors.text,fontSize:16,fontWeight:"600"},sendBtn:{minWidth:66,height:44,paddingHorizontal:14,borderRadius:15,alignItems:"center",justifyContent:"center",backgroundColor:theme.colors.primary},sendBtnDisabled:{opacity:.42},sendTxt:{color:"#FFF",fontWeight:"900",fontSize:14},pressed:{opacity:.82}
});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(ChatScreen);
