import { requireAccount } from "../../src/ui/AccountRequired";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PremiumHeader } from "../../src/ui/PremiumHeader";
import { theme } from "../../src/ui/theme";
import { useI18n } from "../../src/i18n/I18nProvider";
import { API_BASE_URL } from "../../src/lib/config";
import { supabase } from "../../src/lib/supabase";
import { categoryLabel, colorLabel, itemLabel, reportSummary } from "../../src/lib/localizedReport";

function AreaAlertDetails() {
  const router = useRouter();
  const { language, t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error(t("areaAlert.you.must.be.logged.in"));
      const response = await fetch(`${API_BASE_URL}/geo-alert-delivery/${encodeURIComponent(String(id || ""))}/view`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || `HTTP_${response.status}`);
      setData(json);
    } catch (error: any) {
      Alert.alert(t("areaAlert.could.not.open.alert"), error?.message || String(error));
    } finally { setLoading(false); }
  }, [id, language]);

  useEffect(() => { void load(); }, [load]);
  const campaign = data?.campaign;
  const report = campaign?.reports;
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.safe}>
      <PremiumHeader title={t("areaAlert.area.alert")} onBack={() => router.back()} />
      {loading ? <View style={styles.center}><ActivityIndicator /></View> : !campaign ? <View style={styles.center}><Text style={styles.muted}>{t("areaAlert.alert.unavailable")}</Text></View> :
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{t("areaAlert.lost.item.near.you")}</Text>
          <Text style={styles.title}>{reportSummary(report, language) || (t("areaAlert.lost.item"))}</Text>
          <Text style={styles.meta}>{report?.location_label || ""}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.h2}>{t("areaAlert.description")}</Text>
          <Text style={styles.body}>{report?.description || (t("areaAlert.no.description.available"))}</Text>
          <Text style={styles.row}>{t("areaAlert.category")}: {categoryLabel(report?.category, language) || "–"}</Text>
          <Text style={styles.row}>{t("areaAlert.object")}: {itemLabel(report?.subcategory_key, language, report?.category) || "–"}</Text>
          <Text style={styles.row}>{t("areaAlert.color")}: {colorLabel(report?.color, language) || "–"}</Text>
          <Text style={styles.row}>{t("areaAlert.brand")}: {report?.brand || "–"}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.h2}>{t("areaAlert.alert.status")}</Text>
          <Text style={styles.row}>{String(campaign.status).toUpperCase() === "ACTIVE" ? (t("areaAlert.active")) : campaign.status}</Text>
          <Text style={styles.row}>{t("areaAlert.area.radius")}: {campaign.radius_m || "–"} m</Text>
          <Text style={styles.row}>{t("areaAlert.active.until")}: {new Date(campaign.ends_at).toLocaleString(language === "en" ? "en-GB" : "nb-NO")}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.secondaryButton} onPress={() => router.push({ pathname: "/observation-create", params: { campaignId: String(id || ""), kind: "SEEN" } })}><Text style={styles.secondaryButtonText}>{t("areaAlert.i.saw.this")}</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={() => router.push({ pathname: "/observation-create", params: { campaignId: String(id || ""), kind: "FOUND" } })}><Text style={styles.primaryButtonText}>{t("areaAlert.i.found.this")}</Text></Pressable>
        </View>
        <View style={styles.info}><Text style={styles.infoText}>{t("areaAlert.your.information.is.shared.with.the.report.owner.it.does.not.close.the")}</Text></View>
      </ScrollView>}
    </View>
  </>;
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:theme.colors.bg},center:{flex:1,alignItems:"center",justifyContent:"center"},content:{padding:14,paddingBottom:40},muted:{color:theme.colors.muted,fontWeight:"700"},hero:{padding:18,borderRadius:18,backgroundColor:"#EFF6FF",borderWidth:1,borderColor:"#93C5FD"},eyebrow:{fontSize:11,fontWeight:"900",color:"#1D4ED8"},title:{marginTop:7,fontSize:23,fontWeight:"900",color:theme.colors.text},meta:{marginTop:6,fontWeight:"700",color:theme.colors.muted},card:{marginTop:12,padding:16,borderRadius:18,backgroundColor:theme.colors.card,borderWidth:1,borderColor:theme.colors.border},h2:{fontSize:17,fontWeight:"900",color:theme.colors.text},body:{marginTop:10,lineHeight:21,fontWeight:"600",color:theme.colors.text},row:{marginTop:10,fontWeight:"700",color:theme.colors.text},actions:{marginTop:12,flexDirection:"row",gap:8},secondaryButton:{flex:1,minHeight:48,borderRadius:14,borderWidth:1,borderColor:theme.colors.primary,alignItems:"center",justifyContent:"center",backgroundColor:theme.colors.card},secondaryButtonText:{fontWeight:"900",color:theme.colors.primary,textAlign:"center"},primaryButton:{flex:1,minHeight:48,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:theme.colors.primary},primaryButtonText:{fontWeight:"900",color:"#fff",textAlign:"center"},info:{marginTop:12,padding:14,borderRadius:14,backgroundColor:"#F8FAFC",borderWidth:1,borderColor:theme.colors.border},infoText:{fontWeight:"700",lineHeight:19,color:theme.colors.muted}});

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(AreaAlertDetails);
