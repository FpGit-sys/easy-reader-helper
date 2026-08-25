use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[cfg(windows)]
mod platform {
    use super::BASE64;
    use base64::Engine as _;
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN,
            CRYPT_INTEGER_BLOB,
        },
    };

    pub fn protect(value: &str) -> Result<String, String> {
        if value.is_empty() {
            return Err("SECURE_STORE_EMPTY_SECRET".to_string());
        }
        let bytes = value.as_bytes();
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(bytes.len())
                .map_err(|_| "SECURE_STORE_SECRET_TOO_LARGE".to_string())?,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pbData.is_null() || output.cbData == 0 {
            return Err("WINDOWS_DPAPI_PROTECT_FAILED".to_string());
        }
        let protected =
            unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(output.pbData as HLOCAL) };
        Ok(BASE64.encode(protected))
    }

    pub fn unprotect(value: &str) -> Result<String, String> {
        let mut protected = BASE64
            .decode(value)
            .map_err(|_| "SECURE_STORE_INVALID_CIPHERTEXT".to_string())?;
        if protected.is_empty() {
            return Err("SECURE_STORE_INVALID_CIPHERTEXT".to_string());
        }
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(protected.len())
                .map_err(|_| "SECURE_STORE_SECRET_TOO_LARGE".to_string())?,
            pbData: protected.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let mut description = ptr::null_mut();
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                &mut description,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if !description.is_null() {
            unsafe { LocalFree(description as HLOCAL) };
        }
        if ok == 0 || output.pbData.is_null() || output.cbData == 0 {
            return Err("WINDOWS_DPAPI_UNPROTECT_FAILED".to_string());
        }
        let plaintext =
            unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(output.pbData as HLOCAL) };
        String::from_utf8(plaintext).map_err(|_| "SECURE_STORE_INVALID_PLAINTEXT".to_string())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn protect(_value: &str) -> Result<String, String> {
        Err("SECURE_STORE_WINDOWS_REQUIRED".to_string())
    }

    pub fn unprotect(_value: &str) -> Result<String, String> {
        Err("SECURE_STORE_WINDOWS_REQUIRED".to_string())
    }
}

pub fn protect(value: &str) -> Result<String, String> {
    platform::protect(value)
}

pub fn unprotect(value: &str) -> Result<String, String> {
    platform::unprotect(value)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{protect, unprotect};

    #[test]
    fn dpapi_roundtrip_protects_device_token() {
        let token = "slnr_test_device_token_that_must_not_be_plaintext";
        let ciphertext = protect(token).expect("DPAPI should protect a device token");

        assert_ne!(ciphertext, token);
        assert!(!ciphertext.contains(token));
        assert!(ciphertext.len() > token.len());
        assert_eq!(
            unprotect(&ciphertext).expect("DPAPI should recover a protected token"),
            token
        );
    }

    #[test]
    fn dpapi_rejects_empty_secret() {
        assert_eq!(
            protect("").expect_err("empty secrets must be rejected"),
            "SECURE_STORE_EMPTY_SECRET"
        );
    }

    #[test]
    fn dpapi_rejects_invalid_ciphertext() {
        assert!(unprotect("not-base64-***").is_err());
    }
}
