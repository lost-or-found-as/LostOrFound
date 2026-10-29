import { requireAccount } from "../src/ui/AccountRequired";
import { useEffect, useState } from "react";
import { View, Text, Button, ActivityIndicator, Alert } from "react-native";
import { useStripe } from "@stripe/stripe-react-native";
import { API_BASE_URL } from "../src/lib/config";

import { useI18n } from "../src/i18n/I18nProvider";
function PaymentScreen() {
  const { t } = useI18n();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const fetchPaymentIntent = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/create-payment-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 19900 }), // 199,00 NOK
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} – ${text}`);
      }

      const data = await response.json();
      if (!data?.clientSecret) throw new Error("Mangler clientSecret i responsen");

      return data.clientSecret;
    } catch (error: any) {
      console.error("Fetch-feil:", error);
      Alert.alert(t("payment.test.error"), t("payment.test.could.not.contact.the.server"));
      return null;
    }
  };

  const initializePaymentSheet = async () => {
    setInitializing(true);
    const clientSecret = await fetchPaymentIntent();
    if (!clientSecret) {
      setInitializing(false);
      return;
    }

    const { error } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "Repair Lost Or Found",
    });

    if (error) {
      console.log("initPaymentSheet error:", error);
      Alert.alert(t("payment.test.stripe.error"), error.message);
    }

    setInitializing(false);
  };

  const openPaymentSheet = async () => {
    if (loading) return;
    setLoading(true);

    const { error } = await presentPaymentSheet();
    if (error) {
      console.log("presentPaymentSheet error:", error);
      Alert.alert("PaymentSheet", error.message);
    } else {
      Alert.alert(t("payment.test.success"), t("payment.test.payment.completed"));
    }

    setLoading(false);
  };

  useEffect(() => {
    initializePaymentSheet();
  }, []);

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text>{t("payment.test.loading.payment.data")}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ marginBottom: 20 }}>{t("payment.test.tap.to.pay.nok.199")}</Text>
      <Button title={loading ? t("payment.test.opening") : t("payment.test.pay.now")} onPress={openPaymentSheet} disabled={loading} />
    </View>
  );
}

// T1.9A: registered accounts only; guests see the account-required screen.
export default requireAccount(PaymentScreen);
