-keepclassmembers class * extends android.webkit.WebChromeClient {
    public boolean onShowFileChooser(...);
}
-keepclassmembers class * extends android.webkit.WebViewClient {
    public boolean shouldOverrideUrlLoading(...);
}
