/**
 * Native Node-API (N-API) Addon for Electron
 * Window Screen-Share Invisibility & Capture Exclusion
 *
 * Windows: user32.dll -> SetWindowDisplayAffinity(HWND, WDA_EXCLUDEFROMCAPTURE)
 * macOS: AppKit -> [window setSharingType:NSWindowSharingNone]
 */

#include <node_api.h>

#if defined(_WIN32)
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  #include <windows.h>

  // Windows 10 2004+ and Windows 11 flag: excludes window from all capture sessions
  #ifndef WDA_EXCLUDEFROMCAPTURE
    #define WDA_EXCLUDEFROMCAPTURE 0x00000011
  #endif
  #ifndef WDA_NONE
    #define WDA_NONE 0x00000000
  #endif

#elif defined(__APPLE__)
  #import <Cocoa/Cocoa.h>
#endif

/**
 * JS signature: setWindowInvisibility(handleBuffer: Buffer, enable: boolean): boolean
 */
napi_value SetWindowInvisibility(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_status status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok || argc < 2) {
    napi_throw_type_error(env, NULL, "Expected 2 arguments: (handleBuffer: Buffer, enable: boolean)");
    return NULL;
  }

  // 1. Validate and extract handle buffer
  bool is_buffer = false;
  napi_is_buffer(env, args[0], &is_buffer);
  if (!is_buffer) {
    napi_throw_type_error(env, NULL, "First argument must be a native window handle Buffer");
    return NULL;
  }

  void* data = NULL;
  size_t length = 0;
  napi_get_buffer_info(env, args[0], &data, &length);
  if (!data || length < sizeof(void*)) {
    napi_throw_range_error(env, NULL, "Invalid handle buffer length");
    return NULL;
  }

  // 2. Extract enable boolean flag
  bool enable = true;
  napi_get_value_bool(env, args[1], &enable);

  bool success = false;

#if defined(_WIN32)
  // On Windows, the buffer contains the native HWND pointer
  HWND hwnd = *reinterpret_cast<HWND*>(data);
  if (hwnd && IsWindow(hwnd)) {
    DWORD affinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
    BOOL res = SetWindowDisplayAffinity(hwnd, affinity);
    success = (res != FALSE);
  } else {
    napi_throw_error(env, NULL, "Invalid HWND provided in handle buffer");
    return NULL;
  }

#elif defined(__APPLE__)
  // On macOS, Electron's getNativeWindowHandle() returns a pointer to the NSView or NSWindow
  @autoreleasepool {
    void* ptr = *reinterpret_cast<void**>(data);
    if (ptr) {
      NSWindow* window = nil;
      id obj = (__bridge id)ptr;
      if ([obj isKindOfClass:[NSWindow class]]) {
        window = (NSWindow*)obj;
      } else if ([obj isKindOfClass:[NSView class]]) {
        window = [(NSView*)obj window];
      }

      if (window) {
        // NSWindowSharingNone (0) completely excludes the window buffer from CoreGraphics and ScreenCaptureKit
        // NSWindowSharingReadOnly (1) is the standard captureable mode
        window.sharingType = enable ? NSWindowSharingNone : NSWindowSharingReadOnly;
        success = true;
      } else {
        napi_throw_error(env, NULL, "Failed to resolve NSWindow from native handle pointer");
        return NULL;
      }
    }
  }

#else
  // Fallback for Linux or unsupported platforms
  success = false;
#endif

  napi_value result;
  napi_get_boolean(env, success, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc = {
    "setWindowInvisibility",
    NULL,
    SetWindowInvisibility,
    NULL,
    NULL,
    NULL,
    napi_default,
    NULL
  };
  napi_define_properties(env, exports, 1, &desc);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
