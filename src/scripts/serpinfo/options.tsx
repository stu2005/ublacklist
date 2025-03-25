import { Suspense, use, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "../browser.ts";
import { Baseline } from "../components/baseline.tsx";
import { Button } from "../components/button.tsx";
import { Container } from "../components/container.tsx";
import { ControlLabel, Label, LabelWrapper } from "../components/label.tsx";
import { Row, RowItem } from "../components/row.tsx";
import {
  Section,
  SectionBody,
  SectionHeader,
  SectionItem,
  SectionTitle,
} from "../components/section.tsx";
import { Switch } from "../components/switch.tsx";
import { Text } from "../components/text.tsx";
import { AutoThemeProvider } from "../components/theme.tsx";
import { translate } from "../locales.ts";
import { sendMessage } from "../messages.ts";
import { Editor } from "./editor.tsx";
import { parse } from "./parse.ts";
import { storageStore } from "./storage-store.ts";

function SerpInfoSection(): React.ReactNode {
  const UNIVERSAL_PERMISSION = { origins: ["*://*/*"] };

  use(storageStore.attachPromise);
  const settings = storageStore.use.serpInfoSettings();
  const [enableSerpInfoForAll, setEnableSerpInfoForAll] = useState<
    boolean | null
  >(null);
  const [userInput, setUserInput] = useState(settings.user.input);
  const [userInputDirty, setUserInputDirty] = useState(false);
  useEffect(() => {
    browser.permissions.contains(UNIVERSAL_PERMISSION).then((granted) => {
      setEnableSerpInfoForAll(granted);
    });
  }, []);
  const [userSerpInfoError, setUserSerpInfoError] = useState<string | null>(
    null,
  );

  if (enableSerpInfoForAll == null) {
    return;
  }
  return (
    <Section aria-labelledby="serpInfoSectionTitle">
      <SectionHeader>
        <SectionTitle id="serpInfoSectionTitle">
          {translate("options_serpInfoMode_sectionTitle")}
        </SectionTitle>
      </SectionHeader>
      <SectionBody>
        <SectionItem>
          <Row>
            <RowItem expanded>
              <LabelWrapper>
                <ControlLabel for="enableSerpInfo">
                  {translate("options_serpInfoMode_enable")}
                </ControlLabel>
              </LabelWrapper>
            </RowItem>
            <RowItem>
              <Switch
                checked={settings.enabled}
                id="enableSerpInfo"
                onChange={(e) => {
                  const value = e.currentTarget.checked;
                  void sendMessage("enable-serpinfo", value);
                }}
              />
            </RowItem>
          </Row>
        </SectionItem>
        <SectionItem>
          <Row>
            <RowItem expanded>
              <LabelWrapper>
                <ControlLabel for="enableSerpInfoForAll">
                  {translate("options_serpInfoMode_enableForAll")}
                </ControlLabel>
              </LabelWrapper>
            </RowItem>
            <RowItem>
              <Switch
                checked={enableSerpInfoForAll}
                id="enableSerpInfoForAll"
                onChange={(e) => {
                  const value = e.currentTarget.checked;
                  if (value) {
                    void browser.permissions
                      .request(UNIVERSAL_PERMISSION)
                      .then((granted) => {
                        setEnableSerpInfoForAll(granted);
                      });
                  } else {
                    void browser.permissions
                      .remove(UNIVERSAL_PERMISSION)
                      .then((removed) => {
                        setEnableSerpInfoForAll(!removed);
                      });
                  }
                }}
              />
            </RowItem>
          </Row>
        </SectionItem>
        <SectionItem>
          <Row>
            <RowItem expanded>
              <LabelWrapper fullWidth>
                <Label>{translate("options_serpInfoMode_userSerpInfo")}</Label>
              </LabelWrapper>
              <Editor
                height="max(300px, 100vh - 270px)"
                value={userInput}
                onChange={(value) => {
                  setUserInput(value);
                  setUserInputDirty(true);
                }}
              />
            </RowItem>
          </Row>
          <Row right>
            {userSerpInfoError && (
              <RowItem expanded>
                <Text>{userSerpInfoError}</Text>
              </RowItem>
            )}
            <RowItem>
              <Button
                disabled={!userInputDirty}
                primary
                onClick={() => {
                  void sendMessage("set-user-serpinfo", userInput);
                  setUserInputDirty(false);
                  const parseResult = parse(userInput, true);
                  setUserSerpInfoError(
                    parseResult.success ? null : parseResult.error,
                  );
                }}
              >
                {translate("options_serpInfoMode_saveUserSerpInfoButton")}
              </Button>
            </RowItem>
          </Row>
        </SectionItem>
      </SectionBody>
    </Section>
  );
}

const Options: React.FC = () => (
  <AutoThemeProvider>
    <Baseline>
      <Container>
        <Suspense fallback={null}>
          <SerpInfoSection />
        </Suspense>
      </Container>
    </Baseline>
  </AutoThemeProvider>
);

function main(): void {
  document.documentElement.lang = "en";
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  root.render(<Options />);
}

main();
