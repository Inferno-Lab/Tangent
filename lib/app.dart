import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:get/get.dart';
import 'package:tangent/core/bindings/initial_binding.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/routes/app_pages.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/translations/languages.dart';
import 'package:tangent/core/widgets/toast.dart';

class TangentApp extends StatelessWidget {
  const TangentApp({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Get.find<ThemeService>();
    return GetMaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      translations: AppTranslations(),
      locale: theme.locale.value,
      fallbackLocale: const Locale('en'),
      // Flutter's own words (buttons, dates) and right-to-left layout come with the language: Arabic and Urdu read right to left.
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: [for (final code in kAppLanguages) Locale(code)],
      initialBinding: InitialBinding(),
      initialRoute: AppRoutes.splash,
      getPages: AppPages.pages,
      theme: AppTheme.resolve(mode: AppThemeMode.light, platformBrightness: Brightness.light),
      // A new palette from the school rebuilds the themes; the mode, text size and motion come from ThemeService.
      builder: (context, child) => ValueListenableBuilder<int>(
        valueListenable: AppPalette.version,
        builder: (context, _, _) => Obx(() {
          final data = AppTheme.resolve(
            mode: theme.mode.value,
            platformBrightness: MediaQuery.platformBrightnessOf(context),
          );
          final dark = data.brightness == Brightness.dark;
          final ground = data.extension<AppColors>()!.chalk;
          // The status bar's clock and icons follow the theme: with no app bar nothing set them, so they stayed dark on
          // the dark and AMOLED grounds and the top of the screen read as empty.
          final bars = (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
            statusBarColor: Colors.transparent,
            systemNavigationBarColor: ground,
            systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
          );
          return AnnotatedRegion<SystemUiOverlayStyle>(
            value: bars,
            child: AnimatedTheme(
              data: data,
              duration: theme.reduceMotion.value ? Duration.zero : AppMotion.t3,
              curve: kEase,
              child: MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(theme.textScale.value),
                ),
                child: ToastHost(child: child ?? const SizedBox.shrink()),
              ),
            ),
          );
        }),
      ),
    );
  }
}
